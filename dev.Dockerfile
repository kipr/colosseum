FROM node:20-alpine

WORKDIR /app

# Install dependencies (including dev)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Create database directory for SQLite dev usage
RUN mkdir -p /app/database

ENV NODE_ENV=development
ENV PORT=3000
# Improve file watching reliability in containers
ENV CHOKIDAR_USEPOLLING=1

EXPOSE 3000 5173

# Run server + Vite dev client via npm script
CMD ["npm", "run", "dev"]
