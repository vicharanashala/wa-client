# Use standard Node 20 image (Debian-based) which has better support for compiling native C++ modules 
# like @discordjs/opus and werift.
FROM node:20-bookworm-slim

# Install system dependencies needed to build native node modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
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

# Expose the port your app runs on
EXPOSE 3000

# Start the application in production mode
CMD ["npm", "run", "start:prod"]