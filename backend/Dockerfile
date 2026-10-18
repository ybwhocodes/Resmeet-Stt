# ==============================================================================
# Resmeet-STT Backend Dockerfile
# Runtime: Bun.js + TypeScript + Whisper.cpp + Python Audio Filters
# ==============================================================================
FROM oven/bun:1-debian AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-dev \
    git \
    cmake \
    build-essential \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp binary
WORKDIR /tmp/whisper_build
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF \
    && cmake --build build --config Release --target whisper-cli -j$(nproc) \
    && cp build/bin/whisper-cli /usr/local/bin/whisper-cli \
    && rm -rf /tmp/whisper_build

# Install Python audio preprocessing packages (PEP 668 bypass)
RUN pip3 install --no-cache-dir --break-system-packages \
    numpy \
    scipy \
    soundfile \
    noisereduce \
    torch --extra-index-url https://download.pytorch.org/whl/cpu \
    onnxruntime \
    silero-vad

# Set workdir
WORKDIR /app

# Copy dependency files and install
COPY package.json tsconfig.json ./
RUN bun install

# Copy source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p uploads knowledge transcripts_md models

# Expose backend port
EXPOSE 8081

# Default environment
ENV PORT=8081
ENV NODE_ENV=production
ENV DB_HOST=mysql
ENV DB_PORT=3306
ENV DB_NAME=stt_db
ENV DB_USER=root
ENV DB_PASSWORD=password
ENV WHISPER_MODEL=large-v3-turbo

CMD ["bun", "run", "src/index.ts"]
