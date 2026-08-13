#!/system/bin/sh
# kano_engine 云端部署脚本 v21.0.0 —— KANO_TRAFFIC 插件兜底路径(设备侧直连)执行
# 由插件 base64 -d 后以 sh 运行; 不依赖 set -e(busybox 兼容性), 每步显式判断
DIR=/data/data/com.minikano.f50_sms
BIN=$DIR/kano_engine
VER=$DIR/kano_engine.ver
PID=$DIR/kano_engine.pid
CURL=$DIR/files/curl
URL="https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v21.0.0.b64"
MD5="0313814a6958c706c5087e425946f2cd"
BOOT=/sdcard/ufi_tools_boot.sh
BOOTLINE="nohup $BIN >/dev/null 2>&1 &"

C=curl
[ -x "$CURL" ] && C="$CURL"

# 1. 下载 base64 并解码(jsDelivr 国内多节点轮询, 防单节点被阻断)
ok=0
for h in cdn.jsdelivr.net fastly.jsdelivr.net gcore.jsdelivr.net testingcf.jsdelivr.net; do
    U=$(printf '%s' "$URL" | sed "s/cdn.jsdelivr.net/$h/")
    "$C" -fsSL --connect-timeout 10 "$U" -o "$DIR/.ke.b64" && [ -s "$DIR/.ke.b64" ] && { ok=1; break; }
done
[ "$ok" = "1" ] || { echo "部署失败: 下载失败"; rm -f "$DIR/.ke.b64"; exit 1; }
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
printf '%s' '21.0.0' > "$VER"

# 4. 开启 conntrack 记账
printf '1' > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null

# 5. 开机自启(幂等)
touch "$BOOT" 2>/dev/null
grep -qxF "$BOOTLINE" "$BOOT" 2>/dev/null || printf '%s\n' "$BOOTLINE" >> "$BOOT"

# 6. 重启引擎
[ -f "$PID" ] && kill $(cat "$PID" 2>/dev/null) 2>/dev/null
sleep 1
rm -f "$PID"
nohup "$BIN" >/dev/null 2>&1 &
sleep 1
[ -f "$PID" ] && echo "部署完成: 引擎已启动" || echo "部署完成: 启动待确认"
