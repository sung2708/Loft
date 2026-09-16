FROM prom/prometheus:v3.2.1

COPY prometheus.yml /etc/prometheus/prometheus.yml

EXPOSE 9090

# Render supplies PORT at runtime. The persistent disk configured in render.yaml
# stores the WAL while Better Stack Remote Write is temporarily unavailable.
CMD ["sh", "-c", "exec /bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --web.listen-address=0.0.0.0:${PORT:-9090}"]
