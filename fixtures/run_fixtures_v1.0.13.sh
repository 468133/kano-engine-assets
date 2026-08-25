#!/bin/sh
# kano_engine 离线自检(自包含版, 单文件) —— 在路由器上以 root 运行, 不碰真实统计
# v1.0.6: s3 移出交换归属回归 / s4 邻居GC后活跃设备在线与IP回填回归
# v1.0.8: s5 差额归因回归(EUI-64反推MAC / 本机WAN消耗ctLocal / 未归属unattr+unattribTop)
# v1.0.10: s6 台账/累计持久回归(落盘 + 累计恢复 + 重启差分不重复; --test 不再写真实台账路径)
# v1.0.11: s6 追加第三轮(历史天台账重启后不丢, load_daily 全量恢复) / s7 resetsys 只清WAN增量不动台账
# v1.0.12: s8 WAN 0点基线回归(落盘 + 重启沿用不覆盖)
# v1.0.13: s6/s7 加落盘诊断(等死循环 waitdead + dumpwork 目录清单/文件内容), 定位"台账不落盘"类问题
# 用法: sh run_fixtures.sh [引擎路径]
BIN="${1:-/data/data/com.minikano.f50_sms/kano_engine}"
WORK=/data/local/tmp/kano_fixture_run
PASS=0; FAIL=0

mkcase() { # mkcase <目录名>
  rm -rf "$WORK"; mkdir -p "$WORK"
  echo 100000000 > "$WORK/wan_rx"; echo 200000000 > "$WORK/wan_tx"
  : > "$WORK/neigh"   # v1.0.6: 实时邻居表(一行 "ip mac"), 默认空
  cat > "$WORK/local_ips" <<'EOF'
192.168.0.1
10.0.0.180
EOF
  cat > "$WORK/wan_ips" <<'EOF'
10.0.0.180
EOF
}

check() { # check <描述> <期望串> <json>
  if echo "$3" | grep -q "$2"; then echo "  PASS: $1"; PASS=$((PASS+1));
  else echo "  FAIL: $1 (期望包含: $2)"; FAIL=$((FAIL+1)); fi
}

runcase() {
  "$BIN" --test "$WORK" 1 >/dev/null 2>&1 & local EPID=$!
  sleep 1
  # 第二轮前放大字节数(模拟流量增长, 增量才计入); v1.0.7: 模式带尾部空格锚定,
  # 防 "bytes=150" 误伤前面刚替换出的 "bytes=150000"(前缀污染曾致 s1 假 FAIL)
  # v1.0.8: 追加 s5 用值(500/9000 本机WAN, 700/3500 未归属v4, 60/240 未归属v6)
  sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /; s/bytes=2000 /bytes=12000 /; s/bytes=80000 /bytes=280000 /; s/bytes=77804 /bytes=177804 /; s/bytes=300000 /bytes=900000 /; s/bytes=150 /bytes=300 /; s/bytes=450 /bytes=900 /; s/bytes=500 /bytes=5500 /; s/bytes=9000 /bytes=19000 /; s/bytes=700 /bytes=7700 /; s/bytes=3500 /bytes=38500 /; s/bytes=60 /bytes=660 /; s/bytes=240 /bytes=2640 /' "$WORK/nf_conntrack" 2>/dev/null
  sleep 2
  kill "$EPID" 2>/dev/null; sleep 1
  cat "$WORK/kano_engine.json" 2>/dev/null
}

# v1.0.13: 等进程退出最多5s, 防 SIGTERM 后退出路径没落盘完就被读
waitdead() { local i=0; while [ $i -lt 5 ]; do kill -0 "$1" 2>/dev/null || return 0; sleep 1; i=$((i+1)); done; }
# v1.0.13: 台账落盘诊断 —— 目录清单(暴露截断名/临时文件残留) + 台账/累计文件内容
dumpwork() {
  echo "  [diag] ls: $(ls "$WORK" 2>/dev/null | tr '\n' ' ')"
  echo "  [diag] daily: $(cat "$WORK/traffic_daily" 2>/dev/null || echo '<缺失>')"
  echo "  [diag] stats: $(cat "$WORK/traffic_engine_stats" 2>/dev/null || echo '<缺失>')"
}

echo "== s1_basic: v4+v6归属 / v6前导零 / 组播排除 / 本机代理排除 =="
mkcase s1
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
2409:8d3c:310:222:18cc:3a91:399:6b42 aa:bb:cc:00:00:01 $TS
192.168.0.101 aa:bb:cc:00:00:02 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
ipv6     10 tcp      6 96 TIME_WAIT src=2409:8d3c:0310:0222:18cc:3a91:0399:6b42 dst=2606:4700:0000:0000:0000:0000:6811:d005 sport=42362 dport=443 packets=15 bytes=2000 src=2606:4700:0000:0000:0000:0000:6811:d005 dst=2409:8d3c:0310:0222:18cc:3a91:0399:6b42 sport=443 dport=42362 packets=20 bytes=80000 [ASSURED] mark=0 use=1
ipv4     2 udp      17 60 src=192.168.0.101 dst=223.5.5.5 sport=53222 dport=53 packets=2 bytes=150 src=223.5.5.5 dst=10.0.0.180 sport=53 dport=53222 packets=2 bytes=450 [ASSURED] mark=0 use=1
ipv4     2 udp     17 30 src=192.168.0.100 dst=224.0.0.251 sport=5353 dport=5353 packets=1 bytes=87 [UNREPLIED] src=224.0.0.251 dst=192.168.0.100 sport=5353 dport=5353 packets=0 bytes=0 mark=0 use=1
ipv4     2 tcp      6 300 ESTABLISHED src=10.0.0.180 dst=142.250.66.14 sport=40000 dport=443 packets=5 bytes=500 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=40000 packets=6 bytes=9000 [ASSURED] mark=0 use=1
ipv6     10 tcp      6 86400 ESTABLISHED src=2409:8d3c:0310:0222:18cc:3a91:0399:6b42 dst=2408:8206:85e0:2754:0000:0000:0000:ddf6 sport=62015 dport=8445 packets=669 bytes=77804 src=2408:8206:85e0:2754:0000:0000:0000:ddf6 dst=2409:8d3c:0310:0222:18cc:3a91:0399:6b42 sport=8445 dport=62015 packets=700 bytes=300000 [ASSURED] mark=0 use=1
EOF
J=$(runcase); echo "$J" | head -c 500; echo
check "两台设备都归属" '"deviceCount":2' "$J"
check "v4增量=110600 (设备1:10000+100000, 设备2:150+450)" '"iptTotalV4Bytes":110600' "$J"
check "v6增量=910000 (前导零地址规范化+缓存归属, L2:210000+L6:700000)" '"iptTotalV6Bytes":910000' "$J"
check "总增量=1020600" '"iptTotalBytes":1020600' "$J"
check "缓存兜底设备v4地址回填(v1.0.7)" '"ip":"192.168.0.100"' "$J"
check "本机WAN消耗计入ctLocal=15000(v1.0.8, 不进设备)" '"ctLocalBytes":15000' "$J"
if echo "$J" | grep -q '10\.0\.0\.180"'; then echo "  FAIL: 本机代理流量被错误统计"; FAIL=$((FAIL+1)); else echo "  PASS: 本机代理流量未统计"; PASS=$((PASS+1)); fi
if echo "$J" | grep -q '224\.0\.0\.251'; then echo "  FAIL: 组播流量被错误统计"; FAIL=$((FAIL+1)); else echo "  PASS: 组播流量未统计"; PASS=$((PASS+1)); fi

echo "== s2_no_bytes: 内核未开 acct(无 bytes= 字段) =="
mkcase s2
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
192.168.0.101 aa:bb:cc:00:00:02 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 [ASSURED] mark=0 use=1
ipv4     2 udp      17 60 src=192.168.0.101 dst=223.5.5.5 sport=53222 dport=53 packets=2 src=223.5.5.5 dst=10.0.0.180 sport=53 dport=53222 packets=2 [ASSURED] mark=0 use=1
EOF
J=$(runcase); echo "$J" | head -c 300; echo
check "acct 检测为 0" '"acct":0' "$J"
check "降级标记 degraded=1(v1.0.8)" '"degraded":1' "$J"

echo "== s3_drop_swap: 零流量设备被移出后, 存活设备归属不串台(v1.0.6回归) =="
mkcase s3
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
EOF
cat > "$WORK/neigh" <<EOF
192.168.0.100 aa:bb:cc:00:00:01
192.168.0.101 aa:bb:cc:00:00:02
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.101 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
KANO_DROP_IDLE=1 "$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 1
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
echo "192.168.0.101 aa:bb:cc:00:00:02" > "$WORK/neigh"   # A(192.168.0.100) 掉线
sleep 1
sed -i 's/bytes=11000 /bytes=21000 /; s/bytes=150000 /bytes=250000 /' "$WORK/nf_conntrack"
sleep 1   # 本轮 A idle 超阈值被移出, B 从槽1换到槽0, ipmap 必须先删后建
sed -i 's/bytes=21000 /bytes=31000 /; s/bytes=250000 /bytes=350000 /' "$WORK/nf_conntrack"
sleep 2
kill "$EPID" 2>/dev/null; sleep 1
J=$(cat "$WORK/kano_engine.json" 2>/dev/null); echo "$J" | head -c 400; echo
check "A零流量被移出只剩B" '"deviceCount":1' "$J"
check "B上行全量=30000(交换删除后归属不丢)" '"txBytes":30000' "$J"
check "B下行全量=300000(交换删除后归属不丢)" '"rxBytes":300000' "$J"

echo "== s4_cache_online: 邻居被GC但有活跃流量 → 设备在线+IP回填(v1.0.6回归) =="
mkcase s4
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.102 aa:bb:cc:00:00:03 $TS
2409:8d3c:310:222::102 aa:bb:cc:00:00:03 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.102 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
ipv6     10 tcp      6 96 TIME_WAIT src=2409:8d3c:0310:0222:0000:0000:0000:0102 dst=2606:4700:0000:0000:0000:0000:6811:d005 sport=42362 dport=443 packets=15 bytes=2000 src=2606:4700:0000:0000:0000:0000:6811:d005 dst=2409:8d3c:0310:0222:0000:0000:0000:0102 sport=443 dport=42362 packets=20 bytes=80000 [ASSURED] mark=0 use=1
EOF
J=$(runcase); echo "$J" | head -c 500; echo
check "缓存兜底设备有增量后上线过(JSON含该设备)" 'aa:bb:cc:00:00:03' "$J"
check "v4地址已回填且保留(v1.0.7)" '"ip":"192.168.0.102"' "$J"
check "v6地址(前导零规范化)已进ip6s" '2409:8d3c:310:222::102' "$J"
check "总增量=320000 (v4:110000 + v6:210000)" '"iptTotalBytes":320000' "$J"

echo "== s5_attrib_gap: EUI-64反推 / 本机WAN消耗 / 未归属记账(v1.0.8) =="
mkcase s5
cat > "$WORK/neigh" <<EOF
192.168.0.110 aa:bb:cc:00:00:10
2409:8d3c:310:222::110 aa:bb:cc:00:00:10
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.110 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
ipv6     10 tcp      6 431998 ESTABLISHED src=2409:8d3c:0310:0222:8abc:ccff:fe00:0011 dst=2606:4700:0000:0000:0000:0000:6811:d005 sport=42362 dport=443 packets=15 bytes=2000 src=2606:4700:0000:0000:0000:0000:6811:d005 dst=2409:8d3c:0310:0222:8abc:ccff:fe00:0011 sport=443 dport=42362 packets=20 bytes=80000 [ASSURED] mark=0 use=1
ipv4     2 tcp      6 300 ESTABLISHED src=10.0.0.180 dst=142.250.66.14 sport=40000 dport=443 packets=5 bytes=500 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=40000 packets=6 bytes=9000 [ASSURED] mark=0 use=1
ipv4     2 udp      17 60 src=192.168.0.200 dst=8.8.8.8 sport=53222 dport=53 packets=2 bytes=700 src=8.8.8.8 dst=10.0.0.180 sport=53 dport=53222 packets=2 bytes=3500 [ASSURED] mark=0 use=1
ipv6     10 udp      17 60 src=2409:9999:0000:0000:0000:0000:0000:0001 dst=2409:8d3c:0310:0222:9999:0000:0000:5555 sport=1111 dport=2222 packets=2 bytes=60 src=2409:8d3c:0310:0222:9999:0000:0000:5555 dst=2409:9999:0000:0000:0000:0000:0000:0001 sport=2222 dport=1111 packets=2 bytes=240 [ASSURED] mark=0 use=1
EOF
J=$(runcase); echo "$J" | head -c 700; echo
check "邻居设备+EUI-64设备共2台" '"deviceCount":2' "$J"
check "EUI-64反推MAC归属(ff:fe → 88:bc:cc:00:00:11)" '88:bc:cc:00:00:11' "$J"
check "EUI-64设备地址回填进ip6s" '2409:8d3c:310:222:8abc:ccff:fe00:11' "$J"
check "已归属合计=320000 (A-v4:110000 + EUI-v6:210000)" '"iptTotalBytes":320000' "$J"
check "本机WAN消耗=15000 (5000上+10000下)" '"ctLocalBytes":15000' "$J"
check "本机WAN上行=5000" '"ctLocalTxBytes":5000' "$J"
check "未归属合计=45000 (v4:42000 + 入向v6:3000)" '"unattrBytes":45000' "$J"
check "未归属上行=9400 下行=35600" '"unattrTxBytes":9400,"unattrRxBytes":35600' "$J"
check "未归属TOP含192.168.0.200" '"ip":"192.168.0.200","bytes":42000' "$J"
check "未归属TOP含入向v6的LAN侧地址(前导零已规范化)" '"ip":"2409:8d3c:310:222:9999::5555","bytes":3000' "$J"

echo "== s6_ledger_persist: 台账落盘 + 累计恢复 + 重启差分不重复(v1.0.10) =="
# v1.0.10 新增: --test 模式台账/累计写测试目录(此前写真实路径会污染真机统计)
# 断言: 第一轮 SIGTERM 干净退出前落盘; 第二轮(模拟重启)从0差分不重复累计, 累计/台账只增不减
mkcase s6
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
# 第一轮: 引擎启动→流量增长→SIGTERM 干净退出(退出路径落盘台账/累计)
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 1
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
sleep 2
kill "$EPID" 2>/dev/null; waitdead "$EPID"; sleep 1
J1=$(cat "$WORK/kano_engine.json" 2>/dev/null); echo "$J1" | head -c 300; echo
check "第一轮增量=110000 (10000上+100000下)" '"iptTotalBytes":110000' "$J1"
check "累计文件已落盘(up=10000 down=100000)" '"aa:bb:cc:00:00:01":{"up":10000,"down":100000}' "$(cat "$WORK/traffic_engine_stats" 2>/dev/null)"
check "台账文件已落盘且含设备键(今日)" 'aa:bb:cc:00:00:01' "$(cat "$WORK/traffic_daily" 2>/dev/null)"
dumpwork
# 第二轮: 模拟设备重启 → 累计从文件恢复 + 本轮继续差分, 不重复累计
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 1
sed -i 's/bytes=11000 /bytes=21000 /; s/bytes=150000 /bytes=250000 /' "$WORK/nf_conntrack"
sleep 2
kill "$EPID" 2>/dev/null; waitdead "$EPID"; sleep 1
J2=$(cat "$WORK/kano_engine.json" 2>/dev/null); echo "$J2" | head -c 300; echo
check "第二轮增量=110000(重启后从0差分, 不把上轮算进来)" '"iptTotalBytes":110000' "$J2"
check "累计恢复+本轮=20000/200000(只增不重复)" '"aa:bb:cc:00:00:01":{"up":20000,"down":200000}' "$(cat "$WORK/traffic_engine_stats" 2>/dev/null)"
check "台账今日累计=20000/200000" '"aa:bb:cc:00:00:01":{"up":20000,"down":200000}' "$(cat "$WORK/traffic_daily" 2>/dev/null)"
# 第三轮(v1.0.11): 注入一个历史天台账 → 重启引擎 → 再落盘, 断言历史天不被整文件重写抹掉
# (旧版 load_daily_today 只恢复当天 + save_daily 整文件重写 = 引擎一重启历史天全丢, 真机"日报只有最近几天"的根因)
sed -i 's/^{/"1999-1-1":{"aa:bb:cc:00:00:09":{"up":7,"down":77}},/' "$WORK/traffic_daily"
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 1
sed -i 's/bytes=21000 /bytes=31000 /; s/bytes=250000 /bytes=350000 /' "$WORK/nf_conntrack"
sleep 2
kill "$EPID" 2>/dev/null; waitdead "$EPID"; sleep 1
D3=$(cat "$WORK/traffic_daily" 2>/dev/null)
check "历史天台账重启后保留(1999-1-1)" '"1999-1-1":{"aa:bb:cc:00:00:09":{"up":7,"down":77}}' "$D3"
check "第三轮当天台账续增=30000/300000" '"aa:bb:cc:00:00:01":{"up":30000,"down":300000}' "$D3"
dumpwork

echo "== s7_resetsys: resetsys 只清WAN增量, 不动设备计数与台账(v1.0.11) =="
mkcase s7
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 1
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
echo 100050000 > "$WORK/wan_rx"; echo 200030000 > "$WORK/wan_tx"   # WAN 增量 → sysDelta=80000
sleep 2
printf 'resetsys' > "$WORK/cmd"   # v1.0.11: 自检模式引擎读测试目录 cmd 文件
sleep 3   # 等主循环下一轮消费命令并写 JSON
kill "$EPID" 2>/dev/null; waitdead "$EPID"; sleep 1
J=$(cat "$WORK/kano_engine.json" 2>/dev/null); echo "$J" | head -c 300; echo
check "resetsys 后 sysDelta 已清零" '"sysDeltaBytes":0,"sysDeltaTxBytes":0,"sysDeltaRxBytes":0' "$J"
check "resetsys 不动设备合计(=110000)" '"iptTotalBytes":110000' "$J"
check "resetsys 不动台账" 'aa:bb:cc:00:00:01' "$(cat "$WORK/traffic_daily" 2>/dev/null)"
dumpwork

echo
echo "== s8_daybase: WAN 0点基线落盘 + 重启沿用不覆盖(v1.0.12) =="
mkcase s8
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
# 第一轮: 启动即应把当日基线(wan_rx/wan_tx 初值 100000000/200000000)落盘
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 2
kill "$EPID" 2>/dev/null; sleep 1
B1=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "0点基线已落盘(含今日与初值)" "^$(date +%Y)-.* 100000000 200000000" "$B1"
# 第二轮: 计数器已涨(模拟重启后), 基线文件仍是今天 → 沿用不覆盖
echo 100050000 > "$WORK/wan_rx"; echo 200030000 > "$WORK/wan_tx"
"$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
sleep 2
kill "$EPID" 2>/dev/null; sleep 1
B2=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "重启后基线沿用不覆盖(仍100000000/200000000)" " 100000000 200000000" "$B2"

echo
echo "== 结果: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && echo "全部通过" || echo "存在失败项, 把本输出发给开发者"
rm -rf "$WORK"
