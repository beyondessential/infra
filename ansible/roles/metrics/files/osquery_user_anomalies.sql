SELECT
  *
FROM
  (
    SELECT
      u.username,
      u.uid,
      u.gid,
      u.shell,
      u.directory,
      CASE
        WHEN u.shell NOT IN (
          '/bin/bash',
          '/bin/false',
          '/bin/sh',
          '/bin/zsh',
          '/sbin/nologin',
          '/usr/bin/bash',
          '/usr/bin/false',
          '/usr/bin/fish',
          '/usr/bin/nologin',
          '/usr/bin/zsh',
          '/usr/sbin/nologin'
        ) THEN 'unusual_shell'
        WHEN u.directory NOT LIKE '/home/%'
        AND u.uid >= 1000 THEN 'unusual_home'
        WHEN u.username LIKE '%$%'
        OR u.username LIKE '%..%' THEN 'suspicious_username'
        ELSE 'normal'
      END AS anomaly_type
    FROM
      users u
    WHERE
      (
        u.uid >= 1000
        OR u.uid = 0
      )
      AND u.uid != 65534
    ORDER BY
      u.username
  ) t
WHERE
  anomaly_type != 'normal';
