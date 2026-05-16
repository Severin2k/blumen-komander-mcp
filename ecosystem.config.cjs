module.exports = {
  apps: [{
    name: "blumen-mcp",
    script: "dist/index.js",
    cwd: "/home/dev/blumen-mcp",
    env: {
      TRANSPORT: "http",
      PORT: "3100"
    },
    watch: false,
    restart_delay: 5000
  }]
};
