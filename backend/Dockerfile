# ==============================================================================
# Resmeet-STT Rust Backend Dockerfile
# Multi-Stage Build:
#   Stage 1: Whisper.cpp C++ Builder (whisper-cli)
#   Stage 2: Rust 1.85+ Builder (resmeet-backend binary)
#   Stage 3: Debian Slim Minimal Runtime
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build whisper-cli
# ------------------------------------------------------------------------------
FROM debian:trixie-slim AS whisper-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/whisper
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF \
    && cmake --build build --config Release --target whisper-cli -j$(nproc) \
    && cp build/bin/whisper-cli /usr/local/bin/whisper-cli || cp build/bin/main /usr/local/bin/whisper-cli

# ------------------------------------------------------------------------------
# Stage 2: Build Rust Axum Backend
# ------------------------------------------------------------------------------
FROM rust:latest AS rust-builder

WORKDIR /usr/src/app

# Pre-cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Copy real Rust source code
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ------------------------------------------------------------------------------
# Stage 3: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM debian:trixie-slim AS runtime

# Install runtime dependencies (FFmpeg, OpenMP, CA certificates, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy whisper-cli from stage 1
COPY --from=whisper-builder /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /tmp/whisper/build/bin/lib*.so* /usr/local/lib/
RUN ldconfig

# Copy Rust backend binary from stage 2
COPY --from=rust-builder /usr/src/app/target/release/resmeet-backend /usr/local/bin/resmeet-backend

# Ensure required runtime storage directories exist
RUN mkdir -p /app/models /app/uploads /app/transcripts_md /app/dist

# Default runtime environment variables
ENV PORT=8200
ENV WHISPER_MODEL=ggml-large-v3-turbo-q5_0.bin
ENV CPU_THREADS=4
ENV RUST_LOG=resmeet_backend=info,tower_http=info

EXPOSE 8200

HEALTHCHECK --interval=5s --timeout=5s --retries=5 \
    CMD curl -f http://localhost:8200/api/health || exit 1

CMD ["resmeet-backend"]
