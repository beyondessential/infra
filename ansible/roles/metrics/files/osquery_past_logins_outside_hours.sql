SELECT
  l.time,
  l.username,
  l.tty,
  l.host,
  l.type,
  u.uid,
  u.gid,
  u.shell,
  u.directory as home_dir,
  CASE
    WHEN CAST(
      strftime ('%H', datetime (l.time, 'unixepoch')) AS INTEGER
    ) > 20
    OR CAST(
      strftime ('%H', datetime (l.time, 'unixepoch')) AS INTEGER
    ) < 8 THEN 'business_hours'
    ELSE 'outside_business_hours'
  END AS login_timing,
  CASE
    WHEN strftime ('%w', datetime (l.time, 'unixepoch')) IN ('0', '6') THEN 'weekend'
    ELSE 'weekday'
  END AS day_type,
  CASE
    WHEN u.uid = 0 THEN 'root_login'
    WHEN u.uid < 1000 THEN 'system_account'
    ELSE 'regular_user'
  END AS account_type
FROM
  last l
  JOIN users u ON l.username = u.username
WHERE
  l.time > (strftime ('%s', 'now') - 86400)
ORDER BY
  l.time DESC;
