# Use standard Node 20 image (Debian-based) which has better support for compiling native C++ modules 
# like @discordjs/opus and werift.
FROM node:20-bookworm-slim

# Install system dependencies needed to build native node modules + Infisical CLI
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    bash \
    && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
    && apt-get update && apt-get install -y infisical \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Expose the port your app runs on
EXPOSE 3000

# Use entrypoint script which injects Infisical secrets before starting the app
ENTRYPOINT ["./entrypoint.sh"]