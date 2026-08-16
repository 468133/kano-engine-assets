#!/bin/sh
# kano_engine 离线自检(自包含版, 单文件) —— 在路由器上以 root 运行, 不碰真实统计
# v1.0.6: 新增 s3 移出交换归属回归 / s4 邻居GC后活跃设备在线与IP回填回归; 各用例提速
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
}

check() { # check <描述> <期望串> <json>
  if echo "$3" | grep -q "$2"; then echo "  PASS: $1"; PASS=$((PASS+1));
  else echo "  FAIL: $1 (期望包含: $2)"; FAIL=$((FAIL+1)); fi
}

runcase() {
  "$BIN" --test "$WORK" 1 >/dev/null 2>&1 & local EPID=$!
  sleep 1
  # 第二轮前放大字节数(模拟流量增长, 增量才计入)
  sed -i 's/bytes=1000/bytes=11000/; s/bytes=50000/bytes=150000/; s/bytes=2000/bytes=12000/; s/bytes=80000/bytes=280000/; s/bytes=77804/bytes=177804/; s/bytes=300000/bytes=900000/; s/bytes=150/bytes=300/; s/bytes=450/bytes=900/' "$WORK/nf_conntrack" 2>/dev/null
  sleep 2
  kill "$EPID" 2>/dev/null; sleep 1
  cat "$WORK/kano_engine.json" 2>/dev/null
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
check "v6增量=810000 (前导零地址规范化+缓存归属)" '"iptTotalV6Bytes":810000' "$J"
check "总增量=920600" '"iptTotalBytes":920600' "$J"
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
sed -i 's/bytes=1000/bytes=11000/; s/bytes=50000/bytes=150000/' "$WORK/nf_conntrack"
echo "192.168.0.101 aa:bb:cc:00:00:02" > "$WORK/neigh"   # A(192.168.0.100) 掉线
sleep 1
sed -i 's/bytes=11000/bytes=21000/; s/bytes=150000/bytes=250000/' "$WORK/nf_conntrack"
sleep 1   # 本轮 A idle 超阈值被移出, B 从槽1换到槽0, ipmap 必须先删后建
sed -i 's/bytes=21000/bytes=31000/; s/bytes=250000/bytes=350000/' "$WORK/nf_conntrack"
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
check "缓存兜底设备标记在线" '"online":true' "$J"
check "v4地址已回填" '"ip":"192.168.0.102"' "$J"
check "v6地址(前导零规范化)已进ip6s" '2409:8d3c:310:222::102' "$J"
check "总增量=320000 (v4:110000 + v6:210000)" '"iptTotalBytes":320000' "$J"

echo
echo "== 结果: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && echo "全部通过" || echo "存在失败项, 把本输出发给开发者"
rm -rf "$WORK"
