use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use sqlx::{PgPool, Row};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};
use uuid::Uuid;

use crate::auth::{hash_password, verify_password};

#[derive(Clone)]
pub struct SecretCipher {
    key: [u8; 32],
}

impl SecretCipher {
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| format!("Gagal membuat direktori kunci AI: {e}"))?;
        let path = dir.join("ai-encryption.key");
        if !path.exists() {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            let temp = dir.join(format!(".ai-encryption-{}.tmp", Uuid::new_v4()));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temp)
                .map_err(|e| format!("Gagal membuat kunci AI: {e}"))?;
            if let Err(error) = file.write_all(&key).and_then(|_| file.sync_all()) {
                let _ = fs::remove_file(&temp);
                return Err(format!("Gagal menyimpan kunci AI: {error}"));
            }
            drop(file);
            // Publish a fully written key without replacing another process's key.
            // Workers/API instances starting together must all observe the same bytes.
            let installed = fs::hard_link(&temp, &path);
            let _ = fs::remove_file(&temp);
            match installed {
                Ok(()) => return Ok(Self { key }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(format!("Gagal memasang kunci AI: {error}")),
            }
        }
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .and_then(|mut file| file.read_to_end(&mut bytes))
            .map_err(|e| format!("Gagal membaca kunci AI: {e}"))?;
        let key: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "Kunci enkripsi AI tidak valid (harus 32 byte).".to_string())?;
        Ok(Self { key })
    }

    pub fn seal(&self, user_id: Uuid, plaintext: &str) -> Result<(String, String), String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| "Kunci AI tidak valid")?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext.as_bytes(),
                    aad: user_id.as_bytes(),
                },
            )
            .map_err(|_| "Gagal mengenkripsi API key")?;
        let mut sealed = nonce.to_vec();
        sealed.extend_from_slice(&ciphertext);
        Ok((
            hash_password(plaintext),
            format!("v1:{}", hex::encode(sealed)),
        ))
    }

    pub fn open(&self, user_id: Uuid, hash: &str, sealed: &str) -> Result<String, String> {
        let encoded = sealed
            .strip_prefix("v1:")
            .ok_or("Format API key terenkripsi tidak dikenal")?;
        let bytes = hex::decode(encoded).map_err(|_| "Data API key terenkripsi rusak")?;
        if bytes.len() < 28 {
            return Err("Data API key terenkripsi tidak lengkap".into());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| "Kunci AI tidak valid")?;
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&bytes[..12]),
                Payload {
                    msg: &bytes[12..],
                    aad: user_id.as_bytes(),
                },
            )
            .map_err(|_| "API key gagal didekripsi; periksa kunci enkripsi aplikasi")?;
        let value = String::from_utf8(plaintext).map_err(|_| "API key bukan UTF-8")?;
        if !verify_password(&value, hash) {
            return Err("Hash API key tidak cocok".into());
        }
        Ok(value)
    }
}

pub async fn migrate_ai_keys(pool: &PgPool, cipher: &SecretCipher) -> Result<(), String> {
    let legacy_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_ai_settings' AND column_name = 'api_key')"
    ).fetch_one(pool).await.map_err(|e| e.to_string())?;
    if legacy_exists {
        let rows = sqlx::query(
            "SELECT user_id, api_key FROM user_ai_settings WHERE api_key <> '' AND COALESCE(api_key_ciphertext, '') = ''"
        ).fetch_all(pool).await.map_err(|e| e.to_string())?;
        for row in rows {
            let user_id: Uuid = row.get("user_id");
            let plaintext: String = row.get("api_key");
            let (hash, sealed) = cipher.seal(user_id, &plaintext)?;
            sqlx::query("UPDATE user_ai_settings SET api_key_hash = $1, api_key_ciphertext = $2 WHERE user_id = $3")
                .bind(hash).bind(sealed).bind(user_id).execute(pool).await.map_err(|e| e.to_string())?;
        }
    }
    let rows = sqlx::query("SELECT user_id, api_key_hash, api_key_ciphertext FROM user_ai_settings WHERE COALESCE(api_key_ciphertext, '') <> ''")
        .fetch_all(pool).await.map_err(|e| e.to_string())?;
    for row in rows {
        let user_id: Uuid = row.get("user_id");
        let hash: String = row.get("api_key_hash");
        let sealed: String = row.get("api_key_ciphertext");
        let _ = cipher.open(user_id, &hash, &sealed);
    }
    if legacy_exists {
        sqlx::query("ALTER TABLE user_ai_settings DROP COLUMN api_key")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    #[test]
    fn simultaneous_api_and_worker_startups_share_one_complete_key() {
        let dir = std::env::temp_dir().join(format!("resmeet-key-test-{}", Uuid::new_v4()));
        let threads = (0..8)
            .map(|_| {
                let path = dir.clone();
                std::thread::spawn(move || SecretCipher::load_or_create(&path).unwrap())
            })
            .collect::<Vec<_>>();
        let ciphers = threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect::<Vec<_>>();
        let id = Uuid::new_v4();
        let (hash, sealed) = ciphers[0].seal(id, "test-secret").unwrap();
        for cipher in ciphers {
            assert_eq!(cipher.open(id, &hash, &sealed).unwrap(), "test-secret");
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.join("ai-encryption.key"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
