FROM node:22-alpine3.19
WORKDIR /app

ARG IMAGE_VERSION

LABEL name="Export to Ghostfolio on Web"
LABEL description="Convert transaction history export from your favorite broker to a format that can be imported in Ghostfolio."
LABEL author="Dick Wolff & JuanmanDev"
LABEL version="$IMAGE_VERSION"

COPY . .

# Install all dependencies (including dev dependencies)
RUN npm install

# Run the generate command
RUN node --run web:generate

# Remove dev dependencies
RUN npm prune --production

# Create necessary directories
RUN mkdir -p /var/tmp/e2g-input /var/tmp/e2g-output /var/tmp/e2g-cache

EXPOSE 3001

ENTRYPOINT [ "node" ]
CMD ["--run", "server"]
