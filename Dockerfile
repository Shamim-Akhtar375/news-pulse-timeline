# Use Node.js runtime as base
FROM node:22-slim

# Install Python, pip, and venv tools
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Set directory
WORKDIR /app

# Install Node dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Create python virtual environment and install dependencies
COPY requirements.txt ./
RUN python3 -m venv venv && ./venv/bin/pip install -r requirements.txt

# Copy all codebase
COPY . .

# Expose API port
EXPOSE 8000

# Prepend the virtual environment's bin folder to PATH
ENV PATH="/app/venv/bin:${PATH}"

# Launch Node server
CMD ["node", "backend/server.js"]
