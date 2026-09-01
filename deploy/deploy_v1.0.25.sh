#!/system/bin/sh
# kano_engine 云端部署脚本 v1.0.25 —— KANO_TRAFFIC 插件兜底路径(设备侧直连)执行
# v1.0.22: 热修 —— 二进制自报版本号误为1.0.20(编译忘升ENGINE_REV)+deploy_b64含CR致base64解码失败+deploy内嵌MD5与二进制不符, 三处叠加导致v1.0.21永远装不上/装了也永远提示更新; 本版仅修版本串与部署链路, 功能同v1.0.21
# v1.0.23: ① conn_tab 连接基线TTL过期(默认24轮≈2分钟, KANO_CONN_TTL可覆盖) —— 治"跑一段时间后流量偶发偏少+哈希退化拉高CPU";
#         ② 邻居表 netlink dump 降频每3轮一次(首轮即刷)降CPU; ③ JSON内容不变时跳过重写只刷mtime(30s新鲜度闸门不断)
# v1.0.25: ① resetsys keepday 语义修正 —— 归档只清归档点之前: sys 回填今日台账 __wan__ 值(不归零), win_dev 回填今日设备键求和
#         (真机实锤: 00:00归档/03:52补归档, 旧版清零抹掉 0点~3:52 的 WAN 流量); 裸 resetsys 全清不变
#         ② --once 自检试跑隔离: 状态(save_daily/save_stats/save_sysdelta/daybase)不落盘, 防与常驻引擎并发互踩
# 由插件 base64 -d 后以 sh 运行; 不依赖 set -e(busybox 兼容性), 每步显式判断
# v1.0.12: WAN 0点基线(kano_wan_daybase, 换天落盘当日计数器, 插件今日流量真0点对齐)
# v1.0.13: 修 --test 自检模式台账/累计路径数组按初始串定长被 snprintf 截断(fixtures s6/s7 全 FAIL 根因)
# v1.0.14: WAN计数器归零补偿(daybase 7字段 off), 设备重启后今日流量不丢
# v1.0.15: 修重启后永久假降级(acct_on 成功分支复位+数据自愈+重试提速60s)
# v1.0.16: resetsys 连带清空按日台账(归档重计后排行/按日趋势不再显示旧日期) + WAN 逐日台账(__wan__ 伪键)
# v1.0.17: 新增 deldays 命令 —— 区间归档重计后按天删台账(流量已进区间快照, 不留残影)
# v1.0.18: 同窗口归因计数器(devDelta/ctLocalDelta 随 resetsys 同清) —— 修首次归档后归因"设备合计>WAN总量"错位
# v1.0.19: sysDelta/同窗口计数器/WAN last 持久化(kano_wan_sysdelta) —— 引擎重启后系统增量不归零, 停机段首轮补回
# v1.0.20: 台账补种 —— 升级首启无 sysdelta 文件时, 用按日台账 __wan__ "今天以前"的天补回 sysDelta/win_dev
DIR=/data/data/com.minikano.f50_sms
BIN=$DIR/kano_engine
VER=$DIR/kano_engine.ver
PID=$DIR/kano_engine.pid
CURL=$DIR/files/curl
MD5="47230575cf840983bbb495ea5ec6c423"
BOOT=/sdcard/ufi_tools_boot.sh
BOOTLINE="nohup $BIN >>$DIR/kano_engine.log 2>&1 &"

C=curl
[ -x "$CURL" ] && C="$CURL"

# 1. 下载 base64 并解码(国内镜像 + jsDelivr 4节点 + GitHub 代理 2节点轮询, 防单源被阻断)
ok=0
for U in \
  "https://cdn.jsdmirror.com/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://jsd.onmicrosoft.cn/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://fastly.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://gcore.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://testingcf.jsdelivr.net/gh/468133/kano-engine-assets@main/binaries/kano_engine_v1.0.25.b64" \
  "https://ghfast.top/https://raw.githubusercontent.com/468133/kano-engine-assets/main/binaries/kano_engine_v1.0.25.b64" \
  "https://ghproxy.net/https://raw.githubusercontent.com/468133/kano-engine-assets/main/binaries/kano_engine_v1.0.25.b64" \
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
printf '%s' '1.0.25' > "$VER"

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
