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
    libopenblas-dev \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libvulkan-dev glslc \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends spirv-headers glslang-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/whisper
ARG WHISPER_CPP_REF=96ec4d9823e9d0211944172da35f9f29134af990
RUN git init . && git remote add origin https://github.com/ggml-org/whisper.cpp.git \
    && git fetch --depth 1 origin "$WHISPER_CPP_REF" && git checkout --detach FETCH_HEAD \
    && cmake -B build -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_VULKAN=ON \
    && cmake --build build --config Release --target whisper-cli whisper-server -j2 \
    && (cp build/bin/whisper-cli /usr/local/bin/whisper-cli || cp build/bin/main /usr/local/bin/whisper-cli) \
    && cp build/bin/whisper-server /usr/local/bin/whisper-server

# ------------------------------------------------------------------------------
# Stage 2: Build Rust Axum Backend
# ------------------------------------------------------------------------------
FROM rust:latest AS rust-builder
ENV CARGO_BUILD_JOBS=2

WORKDIR /usr/src/app

# Pre-cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src target/release/resmeet* target/release/deps/resmeet* target/release/.fingerprint/resmeet*

# Copy real Rust source code
COPY src ./src
RUN find src -type f -exec touch {} + && cargo build --release

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

RUN apt-get update && apt-get install -y --no-install-recommends libopenblas0-pthread libvulkan1 mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/stt-python \
    && /opt/stt-python/bin/pip install --no-cache-dir faster-whisper==1.2.1 av==18.1.0

WORKDIR /app
COPY scripts ./scripts

# Copy whisper-cli from stage 1
COPY --from=whisper-builder /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /usr/local/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=whisper-builder /tmp/whisper/build/bin/lib*.so* /usr/local/lib/
RUN ldconfig

# Copy Rust backend binary from stage 2
COPY --from=rust-builder /usr/src/app/target/release/resmeet-backend /usr/local/bin/resmeet-backend

# Ensure required runtime storage directories exist
RUN mkdir -p /app/models /app/uploads /app/transcripts_md /app/dist

# Default runtime environment variables
ENV PORT=8200
ENV WHISPER_MODEL=ggml-large-v3-turbo-q5_0.bin
ENV CPU_THREADS=2
ENV STT_BATCH_SIZE=1
ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV RUST_LOG=resmeet_backend=info,tower_http=info

EXPOSE 8200

HEALTHCHECK --interval=5s --timeout=5s --retries=5 \
    CMD curl -f http://localhost:8200/api/health || exit 1

CMD ["resmeet-backend"]
