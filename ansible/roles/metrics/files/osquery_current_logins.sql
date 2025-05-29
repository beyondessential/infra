SELECT
  datetime (s.time, 'unixepoch') as login_time,
  s.pid,
  s.user,
  s.host,
  p.name as process_name,
  p.cmdline,
  p.parent,
  CASE
    WHEN in_cidr_block ('100.64.0.0/10', s.host)
    OR in_cidr_block ('fd7a:115c:a1e0:ab12::/64', s.host) THEN 'tailscale'
    WHEN in_cidr_block ('192.168.0.0/16', s.host)
    OR in_cidr_block ('172.16.0.0/12', s.host)
    OR in_cidr_block ('10.0.0.0/8', s.host) THEN 'lan'
    WHEN in_cidr_block ('127.0.0.0/8', s.host)
    OR in_cidr_block ('::1/128', s.host) THEN 'localhost'
    WHEN in_cidr_block ('169.254.0.0/16', s.host) THEN 'link-local'
    WHEN in_cidr_block ('192.0.0.0/24', s.host)
    OR in_cidr_block ('192.0.2.0/24', s.host)
    OR in_cidr_block ('192.88.99.0/24', s.host)
    OR in_cidr_block ('192.168.0.0/16', s.host)
    OR in_cidr_block ('198.18.0.0/15', s.host)
    OR in_cidr_block ('198.51.100.0/24', s.host)
    OR in_cidr_block ('203.0.113.0/24', s.host)
    OR in_cidr_block ('233.252.0.0/24', s.host) THEN 'reserved'
    ELSE 'internet'
  END AS ip_range
FROM
  logged_in_users s
  LEFT JOIN processes p ON s.pid = p.pid
WHERE
  s.type = 'user'
  AND s.time > (strftime ('%s', 'now') - 86400)
ORDER BY
  s.time DESC;
