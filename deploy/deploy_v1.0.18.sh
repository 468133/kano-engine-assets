#!/system/bin/sh
# kano_engine 云端部署脚本 v1.0.18 —— KANO_TRAFFIC 插件兜底路径(设备侧直连)执行
# 由插件 base64 -d 后以 sh 运行; 不依赖 set -e(busybox 兼容性), 每步显式判断
# v1.0.12: WAN 0点基线(kano_wan_daybase, 换天落盘当日计数器, 插件今日流量真0点对齐)
# v1.0.13: 修 --test 自检模式台账/累计路径数组按初始串定长被 snprintf 截断(fixtures s6/s7 全 FAIL 根因)
# v1.0.14: WAN计数器归零补偿(daybase 7字段 off), 设备重启后今日流量不丢
# v1.0.15: 修重启后永久假降级(acct_on 成功分支复位+数据自愈+重试提速60s)
# v1.0.16: resetsys 连带清空按日台账(归档重计后排行/按日趋势不再显示旧日期) + WAN 逐日台账(__wan__ 伪键)
# v1.0.17: 新增 deldays 命令 —— 区间归档重计后按天删台账(流量已进区间快照, 不留残影)
# v1.0.18: 同窗口归因计数器(devDelta/ctLocalDelta 随 resetsys 同清) —— 修首次归档后归因"设备合计>WAN总量"错位
DIR=/data/data/com.minikano.f50_sms
BIN=$DIR/kano_engine
VER=$DIR/kano_engine.ver
PID=$DIR/kano_engine.pid
CURL=$DIR/files/curl
MD5="d9f2bc79c920d0e4146e16dc9141fe7b"
BOOT=/sdcard/ufi_tools_boot.sh
BOOTLINE="nohup $BIN >>$DIR/kano_engine.log 2>&1 &"

C=curl
[ -x "$CURL" ] && C="$CURL"

# 1. 下载 base64 并解码(国内镜像 + jsDelivr 4节点 + GitHub 代理 2节点轮询, 防单源被阻断)
ok=0
for U in \
  "https://cdn.jsdmirror.com/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://jsd.onmicrosoft.cn/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://fastly.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://gcore.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://testingcf.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.18.b64" \
  "https://ghfast.top/https://raw.githubusercontent.com/468133/kano-engine-assets/main/binaries/kano_engine_v1.0.18.b64" \
  "https://ghproxy.net/https://raw.githubusercontent.com/468133/kano-engine-assets/main/binaries/kano_engine_v1.0.18.b64" \
; do
    "$C" -fsSL --connect-timeout 8 --max-time 30 "$U" -o "$DIR/.ke.b64" && [ -s "$DIR/.ke.b64" ] && { ok=1; break; }
done
[ "$ok" = "1" ] || { echo "部署失败: 全部下载源不通"; rm -f "$DIR/.ke.b64"; exit 1; }
(base64 -d "$DIR/.ke.b64" 2>/dev/null || busybox base64 -d "$DIR/.ke.b64" 2>/dev/null) > "$BIN.new"
rm -f "$DIR/.ke.b64"
[ -s "$BIN.new" ] || { echo "部署失败: 解码为空"; rm -f "$BIN.new"; exit 1; }
head -c 4 "$BIN.new" 2>/dev/null | grep -q ELF || { echo "部署失败: 非ELF"; rm -f "$BIN.new"; exit 1; }

# 2. MD5 校验
m=$(md5sum "$BIN.new" 2>/dev/null | awk '{print $1}')
[ "$m" = "$MD5" ] || { echo "部署失败: MD5不匹配 $m"; rm -f "$BIN.new"; exit 1; }

# 3. 就位 + 版本标记
chmod 777 "$BIN.new"
mv -f "$BIN.new" "$BIN"
printf '%s' '1.0.18' > "$VER"

# 4. 开启 conntrack 记账
printf '1' > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null

# 5. 开机自启(幂等)
touch "$BOOT" 2>/dev/null
grep -qxF "$BOOTLINE" "$BOOT" 2>/dev/null || printf '%s\n' "$BOOTLINE" >> "$BOOT"

# 6. 重启引擎(v1.0.8: 输出进日志; 存活判定看进程而非 pid 文件, 启动即崩能看出来)
[ -f "$PID" ] && kill $(cat "$PID" 2>/dev/null) 2>/dev/null
sleep 1
rm -f "$PID"
nohup "$BIN" >>"$DIR/kano_engine.log" 2>&1 &
sleep 2
[ -f "$PID" ] && kill -0 $(cat "$PID" 2>/dev/null) 2>/dev/null && echo "部署完成: 引擎已启动" || { echo "部署完成: 引擎启动失败, 日志:"; tail -c 800 "$DIR/kano_engine.log" 2>/dev/null; }
