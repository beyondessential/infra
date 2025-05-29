SELECT
  *
FROM
  (
    SELECT
      p.pid,
      p.name,
      p.cmdline,
      p.cwd,
      p.uid,
      p.gid,
      u.username,
      p.start_time,
      p.parent,
      CASE
        WHEN p.name IN ('nc', 'netcat', 'socat', 'ncat') THEN 'network_tool'
        WHEN p.cmdline LIKE '%/dev/tcp/%'
        OR p.cmdline LIKE '%bash -i%' THEN 'reverse_shell'
        WHEN p.name LIKE '%proxy%'
        OR p.name LIKE '%tunnel%' THEN 'tunneling_tool'
        WHEN p.cmdline LIKE '%wget%'
        OR p.cmdline LIKE '%curl%'
        AND p.cmdline LIKE '%|%' THEN 'download_exec'
        ELSE 'normal'
      END AS process_risk
    FROM
      processes p
      JOIN users u ON p.uid = u.uid
    WHERE
      p.start_time > (strftime ('%s', 'now') - 3600)
      AND (
        NOT (
          substr (p.name, 1, 1) = 'k'
          OR substr (p.name, 1, 8) = 'systemd-'
          OR p.name = 'init'
        )
        OR p.uid >= 1000
        OR p.uid = 0
      )
    ORDER BY
      p.start_time DESC
  ) t
WHERE
  process_risk != 'normal';
