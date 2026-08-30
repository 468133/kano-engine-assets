#!/bin/sh
# kano_engine 离线自检(自包含版, 单文件) —— 在路由器上以 root 运行, 不碰真实统计
# v1.0.24: s7 第三轮 keepday 断言改新语义(sys 回填今日 __wan__ 而非清零) + 追加第六轮(归档点分段回归:
#           deldays 模拟 00:00 归档清台账 → 归档点后走量 → keepday 后 sysDelta=今日__wan__ 且 >0)
# v1.0.23: s11 连接基线TTL过期重基线回归(KANO_CONN_TTL=2); 邻居表降频/JSON跳写不影响自检模式(均已豁免)
# v1.0.22: 随引擎热修版改名重跑(版本串/部署链路修复, 断言同 v1.0.21)
# v1.0.19:  harness 重写为「事件驱动等待」(真机 FAIL=44 根因: 固定 sleep 计时竞争 ——
#           子进程退出/写盘时机与脚本读取错位, 各轮互相污染; 引擎本体经真机 JSON 验证无恙):
#           ① 开机自测 sleep 精度, 不准用 ping 兜底(pace1)
#           ② wait_boot 等首轮 JSON / wait_cycle 等 ts 翻页 / wait_json_for 等字段值 / wait_file_not 等落盘变化
#           ③ waitdead 延到 10s + kill -9 兜底, 杜绝上一轮引擎活进下一轮
#           ④ FAIL 附带 [actual] 实际值摘录(前端 grep 已放行该行), 远程可诊断
# v1.0.21: s7 追加第五轮 —— 未归属地址表(un_tab)随 resetsys 同清断言: 注入不在 neigh_cache 的
#           LAN 地址(192.168.0.200) → 归属失败入 un_tab(unattr>0); resetsys 后 unattr=0 + 未归属TOP清空
# v1.0.18: s7 第二轮追加同窗口归因断言(resetsys 后 devDelta/ctLocalDelta 同步清零)
# v1.0.17: s7 追加第四轮(deldays 按天删台账, 区间归档重计联动)
# v1.0.16: s7 语义变更 —— resetsys 连带清空按日台账; WAN 逐日台账断言(__wan__ 伪键); keepday 变体
# v1.0.15: s10 acct 降级→恢复回归; mkcase 默认给假 acct 文件, 模拟"内核拒绝"用目录代替文件
# v1.0.14: s9 WAN计数器归零补偿回归
# v1.0.13: s6/s7 落盘诊断 dumpwork
# v1.0.12: s8 WAN 0点基线回归
# v1.0.11: s6 追加第三轮(历史天台账重启后不丢) / s7 resetsys 回归
# v1.0.10: s6 台账/累计持久回归(--test 不写真实台账路径)
# v1.0.8:  s5 差额归因回归
# v1.0.6:  s3 移出交换归属回归 / s4 邻居GC后活跃设备在线与IP回填回归
# 用法: sh run_fixtures.sh [引擎路径]
BIN="${1:-/data/data/com.minikano.f50_sms/kano_engine}"
WORK=/data/local/tmp/kano_fixture_run
PASS=0; FAIL=0
FJSON="$WORK/kano_engine.json"

# ---- 计时基元: 先实测 sleep 是否可信 ----
T0=$(date +%s); sleep 2 2>/dev/null; T1=$(date +%s); SD=$((T1-T0))
if [ "$SD" -ge 1 ]; then SLEEP_OK=1; else SLEEP_OK=0; fi
if [ "$SLEEP_OK" = "1" ]; then
  pace1() { sleep 1; }
else
  pace1() { ping -c 2 -i 1 127.0.0.1 >/dev/null 2>&1; }
fi
echo "[env] bin=$($BIN -v 2>/dev/null) sleep2实测=${SD}s SLEEP_OK=$SLEEP_OK date=$(date '+%F %T')"

mkcase() { # mkcase <目录名>
  rm -rf "$WORK"; mkdir -p "$WORK"
  echo 100000000 > "$WORK/wan_rx"; echo 200000000 > "$WORK/wan_tx"
  printf '1' > "$WORK/acct"   # 假 acct sysctl(可写, 内容1=记账已开)
  : > "$WORK/neigh"   # 实时邻居表(一行 "ip mac"), 默认空
  cat > "$WORK/local_ips" <<'EOF'
192.168.0.1
10.0.0.180
EOF
  cat > "$WORK/wan_ips" <<'EOF'
10.0.0.180
EOF
}

check() { # check <描述> <期望串> <实际内容>
  if echo "$3" | grep -q "$2"; then echo "  PASS: $1"; PASS=$((PASS+1));
  else echo "  FAIL: $1 (期望包含: $2)"; FAIL=$((FAIL+1));
    echo "  [actual] $(echo "$3" | tr '\n' ' ' | head -c 200)"; fi
}

# ---- 事件驱动等待 ----
jts() { grep -m1 -o '"ts":[0-9]*' "$FJSON" 2>/dev/null | cut -d: -f2; }
wait_boot() { # 等引擎首轮 JSON 落盘(最多15s)
  local i=0; while [ $i -lt 15 ]; do
    [ -s "$FJSON" ] && grep -q '"engineRev"' "$FJSON" 2>/dev/null && return 0
    pace1; i=$((i+1)); done
  echo "  [round] 引擎首轮JSON超时(15s)"; return 1
}
wait_cycle() { # wait_cycle <旧ts>: 等一轮新 JSON(ts 翻页, 最多12s)
  local prev="$1" i=0 c
  while [ $i -lt 12 ]; do
    c=$(jts); [ -n "$c" ] && [ "$c" != "$prev" ] && return 0
    pace1; i=$((i+1)); done
  echo "  [round] 等新周期超时(prev=$prev)"; return 1
}
wait2c() { # 改数据后等满两轮, 保证增量已被采集+写出
  local t0; t0=$(jts); wait_cycle "$t0"; wait_cycle "$(jts)"
}
wait_json_for() { # wait_json_for <grep模式> [最多秒]
  local i=0; while [ $i -lt "${2:-15}" ]; do
    grep -q "$1" "$FJSON" 2>/dev/null && return 0
    pace1; i=$((i+1)); done
  echo "  [round] 等JSON超时: $1"; return 1
}
wait_file_not() { # wait_file_not <文件> <grep模式> [最多秒]: 等文件不再含模式(落盘删除生效)
  local i=0; while [ $i -lt "${3:-15}" ]; do
    grep -q "$2" "$1" 2>/dev/null || return 0
    pace1; i=$((i+1)); done
  echo "  [round] 等文件变化超时: $1 !~ $2"; return 1
}

start_eng() { "$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!; wait_boot; }
stop_eng() { kill "$EPID" 2>/dev/null; waitdead "$EPID"; pace1; }

# 等进程退出最多10s, 超时强杀 —— 防 SIGTERM 后退出路径没落盘完就被读/引擎活进下一轮
waitdead() { local i=0; while [ $i -lt 10 ]; do kill -0 "$1" 2>/dev/null || return 0; pace1; i=$((i+1)); done
  kill -9 "$1" 2>/dev/null; echo "  [round] 引擎pid=$1 超时未退出, 已强杀"; }
# 台账落盘诊断 —— 目录清单 + 台账/累计文件内容
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
start_eng
# 放大字节数(模拟流量增长, 增量才计入); 模式带尾部空格锚定, 防前缀污染
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /; s/bytes=2000 /bytes=12000 /; s/bytes=80000 /bytes=280000 /; s/bytes=77804 /bytes=177804 /; s/bytes=300000 /bytes=900000 /; s/bytes=150 /bytes=300 /; s/bytes=450 /bytes=900 /; s/bytes=500 /bytes=5500 /; s/bytes=9000 /bytes=19000 /; s/bytes=700 /bytes=7700 /; s/bytes=3500 /bytes=38500 /; s/bytes=60 /bytes=660 /; s/bytes=240 /bytes=2640 /' "$WORK/nf_conntrack" 2>/dev/null
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 500; echo
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
rm -f "$WORK/acct"; mkdir "$WORK/acct"   # 目录模拟内核拒绝写 sysctl(root 下 444 可写, 目录才必败)
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
192.168.0.101 aa:bb:cc:00:00:02 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 [ASSURED] mark=0 use=1
ipv4     2 udp      17 60 src=192.168.0.101 dst=223.5.5.5 sport=53222 dport=53 packets=2 src=223.5.5.5 dst=10.0.0.180 sport=53 dport=53222 packets=2 [ASSURED] mark=0 use=1
EOF
start_eng
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 300; echo
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
wait_boot
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
echo "192.168.0.101 aa:bb:cc:00:00:02" > "$WORK/neigh"   # A(192.168.0.100) 掉线
wait2c
sed -i 's/bytes=11000 /bytes=21000 /; s/bytes=150000 /bytes=250000 /' "$WORK/nf_conntrack"
wait2c   # 本轮 A idle 超阈值被移出, B 从槽1换到槽0, ipmap 必须先删后建
sed -i 's/bytes=21000 /bytes=31000 /; s/bytes=250000 /bytes=350000 /' "$WORK/nf_conntrack"
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 400; echo
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
start_eng
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /; s/bytes=2000 /bytes=12000 /; s/bytes=80000 /bytes=280000 /' "$WORK/nf_conntrack" 2>/dev/null
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 500; echo
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
start_eng
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /; s/bytes=2000 /bytes=12000 /; s/bytes=80000 /bytes=280000 /; s/bytes=500 /bytes=5500 /; s/bytes=9000 /bytes=19000 /; s/bytes=700 /bytes=7700 /; s/bytes=3500 /bytes=38500 /; s/bytes=60 /bytes=660 /; s/bytes=240 /bytes=2640 /' "$WORK/nf_conntrack" 2>/dev/null
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 700; echo
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
start_eng
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
wait2c
stop_eng
J1=$(cat "$FJSON" 2>/dev/null); echo "$J1" | head -c 300; echo
check "第一轮增量=110000 (10000上+100000下)" '"iptTotalBytes":110000' "$J1"
check "累计文件已落盘(up=10000 down=100000)" '"aa:bb:cc:00:00:01":{"up":10000,"down":100000}' "$(cat "$WORK/traffic_engine_stats" 2>/dev/null)"
check "台账文件已落盘且含设备键(今日)" 'aa:bb:cc:00:00:01' "$(cat "$WORK/traffic_daily" 2>/dev/null)"
dumpwork
# 第二轮: 模拟设备重启 → 累计从文件恢复 + 本轮继续差分, 不重复累计
start_eng
sed -i 's/bytes=11000 /bytes=21000 /; s/bytes=150000 /bytes=250000 /' "$WORK/nf_conntrack"
wait2c
stop_eng
J2=$(cat "$FJSON" 2>/dev/null); echo "$J2" | head -c 300; echo
check "第二轮增量=110000(重启后从0差分, 不把上轮算进来)" '"iptTotalBytes":110000' "$J2"
check "累计恢复+本轮=20000/200000(只增不重复)" '"aa:bb:cc:00:00:01":{"up":20000,"down":200000}' "$(cat "$WORK/traffic_engine_stats" 2>/dev/null)"
check "台账今日累计=20000/200000" '"aa:bb:cc:00:00:01":{"up":20000,"down":200000}' "$(cat "$WORK/traffic_daily" 2>/dev/null)"
# 第三轮(v1.0.11): 注入一个历史天台账 → 重启引擎 → 再落盘, 断言历史天不被整文件重写抹掉
sed -i 's/^{/"1999-1-1":{"aa:bb:cc:00:00:09":{"up":7,"down":77}},/' "$WORK/traffic_daily"
start_eng
sed -i 's/bytes=21000 /bytes=31000 /; s/bytes=250000 /bytes=350000 /' "$WORK/nf_conntrack"
wait2c
stop_eng
D3=$(cat "$WORK/traffic_daily" 2>/dev/null)
check "历史天台账重启后保留(1999-1-1)" '"1999-1-1":{"aa:bb:cc:00:00:09":{"up":7,"down":77}}' "$D3"
check "第三轮当天台账续增=30000/300000" '"aa:bb:cc:00:00:01":{"up":30000,"down":300000}' "$D3"
dumpwork

echo "== s7_resetsys: WAN逐日台账(__wan__) + resetsys 清WAN增量并清空按日台账(v1.0.16 语义变更) =="
mkcase s7
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
start_eng
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"
echo 100050000 > "$WORK/wan_rx"; echo 200030000 > "$WORK/wan_tx"   # WAN 增量 rx+50000 tx+30000
wait2c
stop_eng
D1=$(cat "$WORK/traffic_daily" 2>/dev/null)
check "WAN逐日台账 __wan__=30000/50000(up=tx,down=rx)" '"__wan__":{"up":30000,"down":50000}' "$D1"
check "设备逐日台账=10000/100000" '"aa:bb:cc:00:00:01":{"up":10000,"down":100000}' "$D1"
# 第二轮: 台账恢复后 resetsys → WAN增量清零 + 按日台账清空(v1.0.16)
# v1.0.18: 先 bump 出 +5000/+50000 增量验证 devDelta 非空转, 再断言 resetsys 后同窗口计数器归零
start_eng
sed -i 's/bytes=11000 /bytes=16000 /; s/bytes=150000 /bytes=200000 /' "$WORK/nf_conntrack" # +5000/+50000
wait2c
JB=$(cat "$FJSON" 2>/dev/null)
check "同窗口设备合计随增量入账(devDelta=5000/50000, v1.0.18)" '"devDeltaTxBytes":5000,"devDeltaRxBytes":50000' "$JB"
printf 'resetsys' > "$WORK/cmd"   # 自检模式引擎读测试目录 cmd 文件
wait_json_for '"sysDeltaBytes":0' 15   # 事件驱动: 消费成功即继续, 不再赌固定 sleep
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 300; echo
D2=$(cat "$WORK/traffic_daily" 2>/dev/null)
check "resetsys 后 sysDelta 已清零" '"sysDeltaBytes":0,"sysDeltaTxBytes":0,"sysDeltaRxBytes":0' "$J"
check "resetsys 后同窗口归因已清零(devDelta=0, v1.0.18)" '"devDeltaBytes":0,"devDeltaTxBytes":0,"devDeltaRxBytes":0' "$J"
check "resetsys 后同窗口本机已清零(ctLocalDelta=0, v1.0.18)" '"ctLocalDeltaBytes":0' "$J"
check "resetsys 不动设备持久累计(stats=15000/150000, 含本轮bump)" '"aa:bb:cc:00:00:01":{"up":15000,"down":150000}' "$(cat "$WORK/traffic_engine_stats" 2>/dev/null)"
if echo "$D2" | grep -q 'aa:bb:cc:00:00:01'; then echo "  FAIL: resetsys 后按日台账仍含设备记录 ($D2)"; FAIL=$((FAIL+1)); else echo "  PASS: resetsys 后按日台账已清空(设备)"; PASS=$((PASS+1)); fi
if echo "$D2" | grep -q '__wan__'; then echo "  FAIL: resetsys 后按日台账仍含WAN记录 ($D2)"; FAIL=$((FAIL+1)); else echo "  PASS: resetsys 后按日台账已清空(WAN)"; PASS=$((PASS+1)); fi
# 第三轮: keepday 变体 —— 日报归档专用, 清历史天但保留今天
# v1.0.24 语义修正: sys 不再清零, 回填为今日 __wan__ 台账值(本轮 WAN +10000/+10000, 与台账同源同值,
# 故期望值从 0 改为 20000/10000/10000; 值不变无法做事件标记, 改等两轮确保 cmd 被消费)
start_eng
sed -i 's/bytes=16000 /bytes=21000 /; s/bytes=200000 /bytes=250000 /' "$WORK/nf_conntrack" # +5000/+50000
echo 100060000 > "$WORK/wan_rx"; echo 200040000 > "$WORK/wan_tx"   # WAN 再 +10000/+10000
wait2c
printf 'resetsys keepday' > "$WORK/cmd"
wait2c
stop_eng
J3=$(cat "$FJSON" 2>/dev/null)
D3=$(cat "$WORK/traffic_daily" 2>/dev/null)
check "keepday 后 sysDelta=今日__wan__值(20000, 不归零, v1.0.24)" '"sysDeltaBytes":20000,"sysDeltaTxBytes":10000,"sysDeltaRxBytes":10000' "$J3"
check "keepday 后 devDelta=今日设备台账求和(5000/50000, v1.0.24)" '"devDeltaTxBytes":5000,"devDeltaRxBytes":50000' "$J3"
check "keepday 保留今天设备台账(本轮增量=5000/50000)" '"aa:bb:cc:00:00:01":{"up":5000,"down":50000}' "$D3"
check "keepday 保留今天WAN台账(=10000/10000)" '"__wan__":{"up":10000,"down":10000}' "$D3"
# 第四轮(v1.0.17): deldays 按天删台账 —— 区间归档重计后删掉已归档天
TK=$(echo "$D3" | grep -o '"[0-9][0-9-]*":{' | head -1 | tr -d '":{')
[ -n "$TK" ] || { echo "  FAIL: 无法从台账解析今日键"; FAIL=$((FAIL+1)); TK="__none__"; }
start_eng
printf 'deldays %s' "$TK" > "$WORK/cmd"
wait_file_not "$WORK/traffic_daily" "$TK" 15   # 事件驱动: 落盘删除生效即继续
stop_eng
D4=$(cat "$WORK/traffic_daily" 2>/dev/null)
if echo "$D4" | grep -q "$TK"; then echo "  FAIL: deldays 后台账仍含 $TK ($D4)"; FAIL=$((FAIL+1)); else echo "  PASS: deldays 已删除指定天台账($TK)"; PASS=$((PASS+1)); fi
if echo "$D4" | grep -q 'aa:bb:cc:00:00:01\|__wan__'; then echo "  FAIL: deldays 后仍有残留记录 ($D4)"; FAIL=$((FAIL+1)); else echo "  PASS: deldays 后台账无设备/WAN残留"; PASS=$((PASS+1)); fi
	# 第五轮(v1.0.21): 未归属地址表随 resetsys 同清 —— 归因四项(sys/win_dev/win_loc/unattr)同窗口,
	# 清除流量后无旧值残留: 注入不在 neigh_cache 的 LAN 地址(192.168.0.200, 双向都以它做LAN端点)
	# → 归属失败入 un_tab; 断言 resetsys 前 unattr>0、resetsys 后 unattr=0 且未归属TOP清空
	start_eng
	cat >> "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.200 dst=142.250.66.15 sport=12345 dport=443 packets=10 bytes=2000 src=142.250.66.15 dst=192.168.0.200 sport=443 dport=12345 packets=12 bytes=80000 [ASSURED] mark=0 use=1
EOF
	echo 100080000 > "$WORK/wan_rx"; echo 200050000 > "$WORK/wan_tx"   # WAN 再 +20000/+10000
	wait2c
	JU=$(cat "$FJSON" 2>/dev/null)
	if echo "$JU" | grep -qE '"unattrBytes":[1-9]'; then echo "  PASS: 未知地址流量已入未归属(unattr>0, v1.0.21)"; PASS=$((PASS+1)); else echo "  FAIL: 未知地址未入未归属 ($(echo "$JU" | head -c 300))"; FAIL=$((FAIL+1)); fi
	printf 'resetsys' > "$WORK/cmd"
	wait_json_for '"unattrBytes":0' 15   # 事件驱动: 清零生效即继续
	stop_eng
	JU2=$(cat "$FJSON" 2>/dev/null)
	check "resetsys 后未归属独立记账已清零(unattr=0, v1.0.21)" '"unattrBytes":0,"unattrTxBytes":0,"unattrRxBytes":0' "$JU2"
	if echo "$JU2" | grep -qE '"unattribTop":\[\]'; then echo "  PASS: resetsys 后未归属TOP已清空(v1.0.21)"; PASS=$((PASS+1)); else echo "  FAIL: 未归属TOP仍有残留 ($(echo "$JU2" | head -c 300))"; FAIL=$((FAIL+1)); fi
	# 第六轮(v1.0.24): keepday 语义修正核心回归 —— 归档只清归档点之前的数据。
	# 模拟真机「00:00 归档、03:52 补归档」: 先走量 → deldays 删今天台账(=00:00 归档快照后清台账)
	# → 归档点后 WAN 再走 +5000/+5000 → keepday 后 sys 必须等于"归档点后"的今日 __wan__ 值(>0)而非归零。
	# 单引擎全程: sys 从引擎启动累计, __wan__ 从 deldays 后重建, 二者差即"归档点前段"(20000)
	start_eng
	sed -i 's/bytes=21000 /bytes=31000 /; s/bytes=250000 /bytes=350000 /' "$WORK/nf_conntrack" # conn1 +10000/+100000
	echo 100090000 > "$WORK/wan_rx"; echo 200060000 > "$WORK/wan_tx"   # WAN +10000/+10000
	wait2c
	J6=$(cat "$FJSON" 2>/dev/null)
	check "keepday语义前置: sysDelta=20000(归档前全量, v1.0.24)" '"sysDeltaBytes":20000,"sysDeltaTxBytes":10000,"sysDeltaRxBytes":10000' "$J6"
	TK6="$(date +%Y)-$(date +%m | sed 's/^0//')-$(date +%d | sed 's/^0//')"   # 台账日期键格式 "%d-%d-%d" 不补零
	printf 'deldays %s' "$TK6" > "$WORK/cmd"      # 模拟 00:00 归档: 快照后删掉今天台账(sys 不动)
	wait_file_not "$WORK/traffic_daily" "$TK6" 15
	echo 100095000 > "$WORK/wan_rx"; echo 200065000 > "$WORK/wan_tx"   # 归档点后又走 +5000/+5000
	wait2c
	printf 'resetsys keepday' > "$WORK/cmd"       # 03:52 补归档
	wait_json_for '"sysDeltaBytes":10000' 15      # 值从30000→10000, 可正确做事件标记
	stop_eng
	J7=$(cat "$FJSON" 2>/dev/null); echo "$J7" | head -c 300; echo
	D6=$(cat "$WORK/traffic_daily" 2>/dev/null)
	check "keepday 后 sysDelta=今日__wan__(10000>0, 不归零, v1.0.24)" '"sysDeltaBytes":10000,"sysDeltaTxBytes":5000,"sysDeltaRxBytes":5000' "$J7"
	check "keepday 后 devDelta=今日设备台账求和(=0, 设备段已随归档删除, v1.0.24)" '"devDeltaBytes":0,"devDeltaTxBytes":0,"devDeltaRxBytes":0' "$J7"
	check "keepday 保留今天WAN台账(=5000/5000, 只含归档点后段, v1.0.24)" '"__wan__":{"up":5000,"down":5000}' "$D6"
dumpwork

echo
echo "== s8_daybase: WAN 0点基线落盘 + 重启沿用不覆盖(v1.0.12) =="
mkcase s8
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
# 第一轮: 启动即应把当日基线(wan_rx/wan_tx 初值 100000000/200000000)落盘
start_eng
stop_eng
B1=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "0点基线已落盘(含今日与初值)" "^$(date +%Y)-.* 100000000 200000000" "$B1"
# 第二轮: 计数器已涨(模拟重启后), 基线文件仍是今天 → 沿用不覆盖
echo 100050000 > "$WORK/wan_rx"; echo 200030000 > "$WORK/wan_tx"
start_eng
stop_eng
B2=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "重启后基线沿用不覆盖(仍100000000/200000000)" " 100000000 200000000" "$B2"

echo
echo "== s9_cntreset: WAN计数器归零补偿 —— 运行中归零折off + 引擎离线期间归零检出(v1.0.14) =="
mkcase s9
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
start_eng   # 启动落基线 100M/200M
echo 150000000 > "$WORK/wan_rx"   # 今日又跑 50M
wait2c
echo 60000000 > "$WORK/wan_rx"    # 计数器归零(设备重启), 重启后又计 60M
wait2c
stop_eng
B=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "运行中归零: rx基线清零+补偿off=50M(今日=50M+60M不丢)" " 0 200000000 50000000 0 " "$B"
# 第二轮: 引擎也重启, 计数器 30M < 文件 last 60M → 离线期间归零检出, 已计段(60M-0)续折 off
echo 30000000 > "$WORK/wan_rx"
start_eng
wait2c
stop_eng
B=$(cat "$WORK/wan_daybase" 2>/dev/null)
check "引擎离线期间归零: 已计段续折 off=110M(今日=110M+30M)" " 0 200000000 110000000 0 " "$B"

echo
echo "== s10_acct_recover: acct 降级→恢复(v1.0.15 真机\"重启后永久降级\"根因修复回归) =="
mkcase s10
rm -f "$WORK/acct"; mkdir "$WORK/acct"   # 开机时 acct 未就绪: sysctl 写不进去(目录模拟)
cat > "$WORK/neigh" <<EOF
192.168.0.100 aa:bb:cc:00:00:01
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 [ASSURED] mark=0 use=1
EOF
start_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 300; echo
check "acct未就绪: acct=0" '"acct":0' "$J"
check "acct未就绪: degraded=1" '"degraded":1' "$J"
# 内核模块晚加载完成 → sysctl 可写; 新连接开始带 bytes=
rmdir "$WORK/acct"; printf '1' > "$WORK/acct"
sed -i 's/packets=10 src=/packets=10 bytes=1000 src=/; s/packets=12 \[ASSURED\]/packets=12 bytes=50000 [ASSURED]/' "$WORK/nf_conntrack"
wait_json_for '"acct":1' 15   # 自检模式每轮重试 enable_acct; 见到 bytes= 也数据驱动自愈
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 300; echo
check "acct恢复: acct=1(标志复位, 不再永久假降级)" '"acct":1' "$J"
check "acct恢复: degraded=0" '"degraded":0' "$J"

echo
echo "== s11_conn_ttl: 连接基线TTL过期后重基线, 计数不丢不乱(KANO_CONN_TTL=2, v1.0.23) =="
mkcase s11
TS=$(date +%s)
cat > "$WORK/neigh_cache" <<EOF
192.168.0.100 aa:bb:cc:00:00:01 $TS
EOF
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=1000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=50000 [ASSURED] mark=0 use=1
EOF
KANO_CONN_TTL=2 "$BIN" --test "$WORK" 1 >/dev/null 2>&1 & EPID=$!
wait_boot
sed -i 's/bytes=1000 /bytes=11000 /; s/bytes=50000 /bytes=150000 /' "$WORK/nf_conntrack"   # +10000/+100000
wait2c
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 300; echo
check "过期前增量=110000 (10000上+100000下)" '"iptTotalBytes":110000' "$J"
# 连接从 conntrack 消失 → last_seen 停刷; TTL=2 即第3个未见轮末过期, 空等4轮确保清掉
: > "$WORK/nf_conntrack"
wait2c; wait2c
# 同四元组连接重建且计数器从零起(新连接): 基线已过期 → 首见只建基线不计;
# 若未过期(回归) → ob<旧基线 按"回退=新连接全量"计 5000+60000=65000 幻影增量
cat > "$WORK/nf_conntrack" <<'EOF'
ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.0.100 dst=142.250.66.14 sport=51234 dport=443 packets=10 bytes=5000 src=142.250.66.14 dst=10.0.0.180 sport=443 dport=51234 packets=12 bytes=60000 [ASSURED] mark=0 use=1
EOF
wait2c
sed -i 's/bytes=5000 /bytes=8000 /; s/bytes=60000 /bytes=90000 /' "$WORK/nf_conntrack"   # +3000/+30000
wait2c
stop_eng
J=$(cat "$FJSON" 2>/dev/null); echo "$J" | head -c 400; echo
check "重基线后总增量=143000(无65000幻影增量, v1.0.23)" '"iptTotalBytes":143000' "$J"
check "设备上行=13000(过期重基线后只计差值)" '"txBytes":13000' "$J"
check "设备下行=130000(过期重基线后只计差值)" '"rxBytes":130000' "$J"
dumpwork

echo
echo "== 结果: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && echo "全部通过" || echo "存在失败项, 把本输出发给开发者"
rm -rf "$WORK"
