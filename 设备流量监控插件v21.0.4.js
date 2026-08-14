//<script>
(async () => {
    // ============================================================
    //  作者tg@钴雮(插件由Kimi AI生成)听大佬话加作者名o(*////▽////*)q
    //  v19.8.3由tg群友(QuKKa)友情打造api接入，从而实现自动识别设备名
    //  设备流量监控插件 v21.0.2
    //  @@KANO_TRAFFIC_PLUGIN_ID:5d1f8b@@  ← 插件自更新标识(勿删, 云端自更新靠它在插件列表里找到本插件)
    //  基于 v19.8.5 + 多IPv6地址跟踪 + iptables规则生命周期管理 + 多设备适配
    //  v19.9.0 改动:
    //    1. B1 多 IPv6 地址跟踪：NDP 按 MAC 聚合全部全球单播地址(ip6s数组)，统计对全部 ip6s 求和，
    //       UI 显示第一个地址 + +v6(N) 角标（修复 Windows 临时 IPv6 轮换后流媒体流量无计数规则的问题）
    //    2. B2 iptables 规则生命周期：ruleOwners 内存台账 + syncRules 每轮同步期望集合，IP 换主先删后建，
    //       启动时解析现有链 adopt(不清零，保留页面关闭期间累计流量)/清理残留，增删规则批量合并 shell 调用
    //    3. B3 仅挂 FORWARD(位置1)，清理 v19.8 遗留的 POSTROUTING/INPUT 挂载和按桥接口插入的 RETURN 规则(v4/v6)
    //       （修复上行双倍计数）
    //    4. B4 resetStats 补 initChain()（在 _cleanMounts 之后、addRule 之前）
    //    5. B5 escHtml 显式转义 & < > " '（修复改名弹窗 value 属性注入逃逸）
    //    6. B6 离线设备可改名（deviceList 查不到时回退 trafficHistory 构造上下文）
    //    7. B7 删除 /proc/net/wireless 信号兜底，信号只用 per-station 数据，无数据显示 --
    //    8. B8 写盘节流：dirty 标记 + >=30s 落盘一次；归档/清除全部/清零/删除设备/改名/手动刷新/停止监控时强制落盘
    //    9. B9 卸载补 -X 删除 KANO_TRAFFIC / KANO_TRAFFIC6 链本身
    //   10. B10 顶部防重复注入 guard
    //   11. B11 月归档触发当天同时写 lastAutoArchiveDay，避免同日双归档
    //   12. 多设备适配：iptables/iptables-legacy/iptables-nft 自动探测(v4+v6，不再硬编码二进制)；
    //       本机地址集合改用 ip -4/-6 addr show 全接口解析（不再硬编码网桥接口）；WiFi 信号用 iw dev
    //       动态枚举接口；新增 DHCP leases 主机名命名回退（自定义名 > 接入设备名 > DHCP租约名 > 历史名 > 默认名）
    //   13. 性能：自动监控 5s tick 默认只做 updateStats+渲染(2次shell)，每 6 tick 完整 fetchDevs+syncRules
    //  v20.0.0 改动:
    //    1. 代码清理(行为不变、UI不变)：删除两个 0 调用的 dead code 函数(shell输出兜底 / v6计数清零)；
    //       两版计数读取函数合并为 getCounters(v6)(解析逻辑逐字保留)；
    //       提取 resetHistoryEntries(now) 消除 history 重建重复块
    //    2. 新功能 单设备限速：filter 表 KANO_LIMIT/KANO_LIMIT6 链挂 FORWARD 位置1(限速需DROP包，与mangle计数链互不干扰)；
    //       hashlimit 模块优先(按字节精确限速)，limit 模块回退(按包pps近似)，均不可用则禁用限速；
    //       每地址独立全额度桶(多IPv6设备不拆分额度)；持久化 traffic_device_limits；30s完整同步时重建；卸载清理；
    //       每行新增 ⏱ 小按钮(有限速时高亮) + 弹窗设置上下行 KB/s；诊断弹窗加限速状态行
    //    3. 响应式UI优化(多断点适配)、限速单位自选(KB/s/MB/s/Kbps/Mbps)、
    //       运行日志系统、诊断弹窗增强(异常流量审计+日志导出)、限速上行规则日志检测
    //    4. 探测降级：启动时建临时链实测 hashlimit/limit 模块(用户环境缺部分命令)，失败自动降级，不硬依赖
    //  v20.0.1 改动(规范审查修复):
    //    F1 修复致命bug: 补 delDevRules 定义(原仅调用未定义，删除设备弹窗点确认必抛 ReferenceError，删除功能完全失效)
    //    F2 修复 /api/user_shell 500: 文件读写统一走 _shUser 包装，user_shell 失败自动回退 root shell
    //       (原所有落盘/读档/日志经 runShellWithUser 静默失败 → 改名不保存/重启丢数据/日志为空)
    //    F3 修复诊断弹窗状态图标全红: _diagItem 原与 HTML 实体比较永不命中，改按字面字符判断
    //    F4 补高级功能(root)前置校验(规范要求)，未开启时明确提示而非误报"未检测到 iptables"
    //    F5 危险操作补弱口令检查 checkWeakToken(卸载/清零/清除全部/删除数据文件，规范强制)
    //    F6 saveToFile 写盘 echo 改 printf '%s'(busybox echo 会解释反斜杠转义，JSON 含 \n 时数据损坏)
    //    F7 修复启动并发双刷: 监控自启与面板展开刷新互斥 + refresh 重入保护
    //  v20.0.2 改动(异常流量根因修复):
    //    F8 日志复制修复: http 页面 navigator.clipboard 不可用(需安全上下文)，降级 select()+execCommand，
    //       失败时如实提示手动复制(原失败被静默吞掉仍提示"已复制")
    //    F9 123GB 异常流量根因修复: updateStats 旧逻辑"计数总和下降即把 lastUp/lastDown 全额累加进 total"，
    //       多IPv6设备临时地址轮换出局时总和必降 → 仍在计数地址的流量被反复重复累加 → 总量虚高。
    //       改为按地址独立台账(addrUp/addrDown)：单地址计数重置只补该地址值；地址出局只补一次后移出台账；
    //       出局保留 >10MB 时写 STATS 日志便于追溯轮换行为。旧数据首轮自动重建基线。
    //  v20.1.0 改动(日志体系 + 限速排障 + 彻底卸载):
    //    G1 限速修复: hashlimit 规则名 kup_/kdown_ + 12位mac = 16/18 字符，超 xt_hashlimit name[IFNAMSIZ=16]
    //       上限(最长15) → 部分内核直接拒绝建规则，探测链能过但正式规则写不进 → 限速完全不生效。
    //       缩短为 ku_/kd_ 前缀(15字符内)；applyLimits 后回读链规则数并写 LIMIT 日志，立刻可见是否生效
    //    G2 日志/诊断弹窗响应式: maxWidth 改 min(px,94vw)，修复手机上弹窗超出屏幕、右侧内容不可见
    //    G3 日志按天保留: 默认 7 天(设置里可改, 0=不按时长清理)，启动+每日自动清理过期行，200条截断保留
    //    G4 卸载彻底: 补删 traffic_debug.log / .tmp / .diag_test 及日志清理日期 localStorage key，无残留
    //    G5 统计排障日志全量落盘: 单地址计数重置 / 地址出局保留 / SYNC规则增删 / 启动adopt / 归档清零动作 /
    //       限速应用回读 均写日志 —— 配合 F9 台账，异常流量从日志即可定位来源
    //  v20.1.1 改动(可用性修正):
    //    H1 弱口令分级: 清零统计/清除全部流量 降级为仅警告不拦截(F5 曾致弱口令用户无法清零脏数据)；
    //       卸载插件/删除数据文件 保持硬拦截，需先在主界面修改管理密码
    //    H2 诊断弹窗"异常流量审计"增强: 免F12 —— 显示设备名/上下行历史+当前分明细/IPv6数/台账数/历史当前比，
    //       三档明确判定(轮换重复累加脏数据 / 疑似多次重置 / 正常)并给出处置建议
    //  v20.1.2 改动(限速排障直达):
    //    H3 限速专项诊断: 限速弹窗新增"一键诊断"按钮 —— 采集①内核hashlimit注册②实测建规则真实报错(2>&1不再静默)
    //       ③KANO_LIMIT链规则与命中包数pkts④hashlimit运行表⑤硬件转发加速模块⑥FORWARD挂载点命中，
    //       报告末尾附判读指南，直接指出卡在哪一环; applyLimits 写入报错不再吞掉直接进日志; 提取通用复制 copyTextSafe
    //  v20.1.3 改动(远程取病情):
    //    I1 限速诊断升级: ③改为 10 秒双采样(T0/T1 pkts 增量) —— 规则每30s重建计数器年轻，单快照 pkts=0 无法定论，
    //       增量直接回答"包到底有没有过这条链"; 新增 ③b KANO_LIMIT6(v6) 双采样 + 被限速设备地址清单(v4/ip6s)，
    //       v6 未启用时明确警告"设备的IPv6流量不受任何限制"(v20.1.2 盲区：手机走IPv6测速时 v4 规则 pkts 恒为 0)
    //    I2 一键导出诊断包: 诊断弹窗底部新增「📦 一键导出诊断包」—— 一次采集 版本/环境信息 + 异常流量审计(文本版) +
    //       限速专项诊断 + 全部运行日志，弹窗内一键复制，发给开发者即可远程定位，无需 F12、无需逐项截图
    //  v20.1.4 改动(弱口令解禁):
    //    J1 卸载插件/删除数据文件 不再因弱口令硬拦截 —— 两个入口本身已有防呆(卸载需连点5次确认/删除数据需在设置中
    //       主动勾选)，弱口令降级为醒目警告并写 SEC 日志后直接放行；无法改密码的用户不再被卡死
    //  v20.1.5 改动(体验收尾):
    //    J2 卸载/删除数据文件的弱口令弹窗彻底移除(用户明确要求) —— 静默放行仅留 SEC 日志；清零类轻提示保留
    //  v20.4.0 改动(归档排序 + 0.5~5s刷新 + 双计/丢数bug修复 + 控制台式日志):
    //    N1 历史归档详情设备按总流量降序排列
    //    N2 刷新间隔范围改 0.5~5s(0.5步进,parseFloat)；新设备探针改时间节流(>=2s一次)，高频刷新不多打shell
    //    N3 归档/清零/设置变更 与监控tick互斥(_refreshing复用): 修复 tick 在"已快照未清零"窗口把旧计数
    //       写回history(快照+当前双计)、或在清零/拆链中途读到半状态误触发"计数器变小补计"的竞态；
    //       归档前先 updateStats 并入链上最新计数，快照与清零之间不再有空窗丢量
    //    N4 累计排行双计修复: 快照新增 reset 标记，累计口径=当前+历次"归档并重计"(不含"仅归档")，
    //       修复仅归档快照与当前统计重叠导致的双倍计数；历史列表加"仅归档"角标
    //    N5 控制台式日志: 新增 _logCmd 记录关键shell操作的 "$命令 ⇒ 输出"(增删规则/清链/清零计数)，
    //       增删规则异常、监控tick异常、手动刷新失败均落盘为 ERR，出问题可直接从日志定位到命令级
    //    N6 设置里关闭IPv6前先并入v6最新计数再清链(不丢尾部流量)；getCounters null 返回值全调用点判空
    //  v20.3.0 改动(移除弱口令 + 统计精度全面加固):
    //    M1 弱口令检测彻底移除(用户明确要求) —— 危险操作统一由防呆确认兜底:
    //       卸载连点5次 / 清除全部流量连点2次 / 删除数据需主动勾选 / 清除日志连点2次 / 回添归档弹窗确认
    //    M3 syncRules 删规则前补读计数器: 上次 tick 到删规则之间(最长一个刷新间隔)的流量先刷进台账
    //       基线再由出局/重建逻辑补入 —— IPv6临时地址轮换、IP换主、设备离线删规则不再丢尾部流量
    //    M4 tick 重入保护: shell 变慢时上一个 tick 未跑完直接跳过(并与手动 refresh 互斥)，
    //       杜绝两个并发 updateStats 交错读写台账触发两次"计数器变小补计" → 重复累加
    //    M5 页面隐藏/关闭尽力落盘(flushHistory) + 恢复可见立即补 tick: 挂起期间 iptables 计数持续增长，
    //       恢复后立刻并入，速率按真实挂起时长平均不虚高
    //    M6 新设备轻量探针: 非完整同步轮只读 /proc/net/arp(每tick仅+1次轻shell)，发现陌生 MAC 当轮
    //       立即完整同步建规则 —— 新设备从"最长30s无规则不计数"缩短到一个刷新间隔内
    //    M7 fetchDevs 瞬态空读保护: ARP+NDP 全空但上轮有设备时沿用上一轮列表，防 shell 抖动导致
    //       全部规则删掉又重建(计数中断+规则churn)
    //    M8 计数器读取失败(null)本轮整体跳过: 不再把瞬态 shell 失败的空读误判为"全部地址出局"，
    //       修复该场景下台账并入 totalUp 而链上计数器仍在 → 下轮 curUp 重复计数的问题
    //  v20.2.0 改动(功能去重 + 可配刷新 + 日志清理 + 归档回添 + 真响应式):
    //    L1 功能去重: 「清零统计」与「清除全部流量」功能重复，删除「清零统计」(按钮/函数/诊断项)，
    //       保留确认步骤更少的「清除全部流量」(保留名称与离线设备记录,仅清空计数)
    //    L2 刷新间隔可配: 设置弹窗新增"监控刷新间隔(秒)"(2~60,默认5)，保存后自动监控立即按新间隔运行；
    //       完整同步(设备发现+规则)固定约30s一次，按当前间隔自动折算 tick 数
    //    L3 日志弹窗新增「清除日志」按钮: 双击确认清空 traffic_debug.log，并写 ACTION 日志
    //    L4 查看历史新增「回添选中」: 将勾选归档的设备流量反向加回正在统计的累计中并移除该归档
    //       (用于撤销误归档/把归档并回当前周期)，二次确认弹窗防误触
    //    L5 响应式重做: 旧版仅靠视口@media，UFI容器内常不生效 —— 改为 ResizeObserver 按容器实际宽度
    //       (<560px 自动紧凑: 隐藏MAC/信号列+缩小字号内边距) + 表格横向滚动常开 + 总览网格自适应列数
    //       + 全部弹窗 maxWidth 统一 min(px,94vw)，手机不再超出屏幕
    //  v20.1.6 改动(日志防洪 + 有线可视性 + 审查修复):
    //    K1 日志防洪: _log 相邻同内容去重；异常流量 WARN 按 mac+量级(每10GB)只记一次 —— 修复自动监控
    //       开启时同一 WARN 每5秒刷一条、200条日志上限被冲爆、有用历史全丢的问题
    //    K2 有线可视性: getAccessDeviceInfo 早已采集 connType(有线/无线) 但从未展示 —— 在线设备名旁
    //       显示 🔌有线/📶无线 角标；诊断弹窗新增「连接方式与拓扑」区(分布统计+/sys/class/net接口枚举+
    //       有线NAT拓扑说明)；诊断包同步新增该节 —— "有线设备没统计"类问题一键自查
    //    K3 诊断弹窗 ARP 解析去重: 删内联重复实现，复用 getArpDevs(先 refreshLocalAddrs，同主流程口径)
    //    K4 健壮性: 限速弹窗 unit key 非法时回退 KB/s(原直接 TypeError 崩弹窗)；清理 _shUser 多余第二参数
    //  v21.0.0 改动(统计引擎 + 云端部署):
    //    P1 统计核心升级: 新增后台 C 二进制 kano_engine(aarch64 static) —— 直读 /proc/net/nf_conntrack
    //       bytes= 字段(自动开启 nf_conntrack_acct)+WAN口 sysfs 兜底, netlink 邻居表按 MAC 聚合
    //       (v4 ARP+v6 NDP 多地址), DHCP租约取主机名, 每5s 原子写 kano_engine.json;
    //       页面关闭期间引擎持续统计, 重开后自动并入, 不再依赖页面 tick
    //    P2 无缝回退: iptables 计数链保持同步作为热备份, 引擎未安装/掉线(JSON超30s未更新)自动回退
    //       原统计路径, 数据不间断; 限速(KANO_LIMIT filter 链)完全不受影响
    //    P3 重计基线: 引擎累计不可被插件清零, 「清除全部流量/归档并重计」改为记录引擎当前累计为基线,
    //       当前段=引擎累计-基线; 引擎重启/计数回退时旧段差额先并入历史再归零基线(同F9保留思路), 无竞态
    //    P4 云端安装/更新: 新增「🛠️ 引擎」管理弹窗 —— 状态面板(统计模式/版本/运行/数据新鲜度/acct/
    //       zeroStreak/WAN/云端版本) + 一键云端部署(jsDelivr CDN: 浏览器 fetch base64 分块写设备解码
    //       为主路径, 设备 curl 拉 deploy 脚本执行为兜底; md5 占位全零时跳过校验) + 启动/停止/重启/
    //       开机自启(/sdcard/ufi_tools_boot.sh 幂等行); jsDelivr 国内可达性差 —— 清单/二进制/deploy
    //       全部走 cdn/fastly/gcore/testingcf 四节点轮询, 清单获取再加设备 curl 兜底(浏览器断网也能装)
    //    P5 引擎自恢复: 插件启动时检测到引擎已安装即确保运行; 静默检查云端新版本(每会话 toast 一次);
    //       诊断弹窗/诊断包新增统计引擎节; 卸载彻底清理引擎文件与 boot 自启行
    //  v21.0.1 改动(引擎启动排障 —— 真机发现"引擎进程活着但 JSON 从不写入"):
    //    Q1 活性判定修复: 旧逻辑"pid文件存在+kill -0 通过=运行中" —— 引擎启动即崩溃时
    //       pid文件残留 + 僵尸进程仍响应 kill -0 → 永远误报运行中且不再重启新实例;
    //       现统一以 /proc/<pid>/stat 状态位为准(Z=僵尸视为已死), startEngine 启动后
    //       二次验证进程存活, 失败即报 ENGINE_STARTFAIL 并把引擎日志尾部写入运行日志
    //    Q2 引擎输出不再丢 /dev/null: nohup 重定向到 kano_engine.log(boot 自启行同步变更),
    //       引擎 v21.0.1 内部新增阶段日志(boot/初始化/首轮/JSON首写/退出), 崩溃点一眼定位;
    //       引擎退出时自删 pid 文件; SIGTERM 不再 SA_RESTART, 停止指令即时生效
    //    Q3 引擎面板新增「🔍 引擎自检」: 杀掉常驻实例 → 前台跑 kano_engine --once 收退出码
    //       (139=段错误/124=阻塞超时/0=正常) + JSON落盘检查 + conntrack/acct 环境检查,
    //       结果直接展示并写运行日志 —— 远程排障一键采集
    //    Q4 stopEngine 优雅停止: TERM 后轮询最多 6s, 不死再 KILL, 最后必删 pid 文件
    //  v21.0.2 改动(多端协作 + 插件自更新):
    //    R1 自动归档多端去重: 根因是 lastAutoArchiveDay 存在 localStorage(每个浏览器各自一份),
    //       手机/电脑同时开着插件页面 → 到点各自归档 → 一天多条日报。改为心跳选主:
    //       每 20s 写 traffic_hb.<id> 心跳文件, 仅"最小心跳id"的存活端执行自动归档(90s 无心跳自动让位),
    //       归档前再从共享快照文件按同名标签去重(6h窗口)双保险; 快照新增 by 字段记录上传端
    //    R2 历史界面显示每条记录的"上传者"(设置里可改本机标识), 支持按上传者筛选
    //    R3 引擎面板新增「🗑 卸载引擎」: 只删引擎二进制/JSON/日志/自启行, 插件数据与统计不动;
    //       原「卸载插件」不变, 依旧完全清理不留残留
    //    R4 插件自身云端自更新(热点流量监控2.0同款机制): latest.json 新增 jsRev,
    //       比本机新 → 引擎面板出现「🔄 更新插件」→ 设备curl/浏览器多源下载 b64 → 校验签名标识
    //       → getCustomHead/setCustomHead 原位替换插件块 → 2s 后自动刷新页面生效;
    //       启动时静默检查, 有新版 toast 一次
    //    R5 云端清单缓存穿透: 设备 curl 全部 URL 追加 ?t=时间戳 + 清单类请求优先走
    //       ghfast/ghproxy 代理的 raw.githubusercontent(无 jsDelivr PoP 缓存, 上传即生效)
    //       —— 修复"仓库已更新但插件仍检测到旧版本 21.0.0"(jsDelivr @main 缓存 12h+)
    //  v21.0.3 改动(自检可用性修复):
    //    S1 引擎自检两段式: 原实现把"杀实例+前台试跑10s+检查"塞进一条 shell(≈13s),
    //       真机被宿主约 10s 强杀(signal is aborted without reason), 且自检期间监控 tick
    //       仍在打 shell 并发抢通道。改为: ① 短命令做环境检查+后台 nohup 启动试跑(结果写文件)
    //       ② JS 等待 14s ③ 短命令读回试跑输出+引擎日志尾部+JSON落盘检查;
    //       全程 _refreshing=true 暂停监控 tick, 独占 shell 通道
    //  v21.0.4 改动(自更新大文件通道修复 + 引擎面板美化 + 引擎看门狗):
    //    T1 插件自更新下载改"设备侧 curl 落盘 + tail/head 分块读回" —— 修复整包走 shell stdout
    //       被宿主掐死返回空(长度0); 读回长度校验防读漏, 浏览器 fetch 兜底; 全程暂停监控tick
    //    T2 引擎面板: 图标 ⚙️→🛠️, 8 个按钮按"主要操作/工具"两行收纳(工具行小号半透明), 功能不变
    //    T3 引擎 v21.0.2: 阶段看门狗 —— 任一采集阶段卡死>10s 记阶段号+自删pid+退出(插件自动拉起),
    //       自检输出直接显示卡在哪一步; 命令文件改非阻塞打开
    // ============================================================

    // B10: 防重复注入
    if (document.querySelector('#IFRAME_KANO_TRAFFIC')) return;

    const CHAIN_NAME = 'KANO_TRAFFIC';
    const CHAIN_NAME6 = 'KANO_TRAFFIC6';
    const LIMIT_CHAIN = 'KANO_LIMIT';    // v19.10.0: 限速链（filter 表，限速需 DROP 包）
    const LIMIT_CHAIN6 = 'KANO_LIMIT6';
    const STORAGE_FILE = '/data/data/com.minikano.f50_sms/traffic_device_stats';
    const NAMES_FILE = '/data/data/com.minikano.f50_sms/traffic_device_names';
    const SNAPSHOTS_FILE = '/data/data/com.minikano.f50_sms/traffic_snapshots';
    const LIMITS_FILE = '/data/data/com.minikano.f50_sms/traffic_device_limits';
    const LIMIT_UNITS = {
        'KB/s': { label: 'KB/s', factor: 1 },
        'MB/s': { label: 'MB/s', factor: 1024 },
        'Kbps': { label: 'Kbps', factor: 0.125 },
        'Mbps': { label: 'Mbps', factor: 128 }
    };

    const MONITOR_STATE_KEY = 'kano_traffic_monitor_state';

    // v21.0.2: 插件自更新标识与版本(热点流量监控2.0同款 customHead 机制)
    const PLUGIN_VERSION = '21.0.4';
    const _SIG = '@@KANO_TRAFFIC_PLUGIN_ID:5d1f8b@@';
    const _PS = '<!-- [KANO_PLUGIN_START]';
    const _PE = '<!-- [KANO_PLUGIN_END]';
    // 版本号比较: a > b 返回 true(按 . 分段数值比较, 21.0.10 > 21.0.2)
    const _verNewer = (a, b) => {
        const pa = String(a || '').replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
        const pb = String(b || '').replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y;
        }
        return false;
    };

    // v21.0.2(R1): 多端心跳 —— 每个浏览器一个固定id(localStorage), 心跳文件写在共享数据目录,
    // 自动归档仅"最小心跳id"的存活端执行, 90s 无心跳视为离线自动让位; 快照 by 字段记录上传端名
    const CLIENT_ID = (() => {
        let id = localStorage.getItem('kano_traffic_client_id');
        if (!id) { id = Math.random().toString(16).slice(2, 6); localStorage.setItem('kano_traffic_client_id', id); }
        return id;
    })();
    let clientName = localStorage.getItem('kano_traffic_client_name') || ('客户端-' + CLIENT_ID);
    const HB_PREFIX = '/data/data/com.minikano.f50_sms/traffic_hb.';
    const DEFAULT_REFRESH_SEC = 5;      // v20.2.0(L2): 默认监控刷新间隔(秒)，设置中可改 2~60
    const FULL_SYNC_MS = 30000;         // v20.2.0(L2): 完整同步(fetchDevs+syncRules)固定约 30s 一次，tick 数按当前间隔折算
    // v20.2.0(L2): 读取当前刷新间隔(毫秒) —— archiveSettings 在后面定义，本函数只在运行期调用，无 TDZ 问题
    // v20.4.0(N2): 范围改为 0.5~5 秒、支持 0.5 步进小数（parseFloat）
    const getRefreshInterval = () => {
        const s = parseFloat(archiveSettings.refreshSeconds);
        return Math.min(5, Math.max(0.5, isNaN(s) ? DEFAULT_REFRESH_SEC : s)) * 1000;
    };
    const HISTORY_SAVE_INTERVAL = 30000; // B8: 写盘节流 30s
    const LEASES_FILES = ['/var/lib/misc/dnsmasq.leases', '/tmp/dnsmasq.leases', '/tmp/dhcp.leases', '/data/dnsmasq.leases'];

    let deviceList = [];
    let trafficHistory = {};
    let customNames = {};
    let snapshots = [];
    let monitorTimer = null;
    let monitorTickCount = 0;
    let resetClickCount = 0;
    let resetClickTimer = null;
    let localAddrs = new Set();   // 本机全部 IPv4 地址（全接口）
    let localAddrs6 = new Set();  // 本机全部 IPv6 地址（全接口，排除链路本地）
    let IPT = '';                 // 探测到的 iptables 二进制
    let IP6T = '';                // 探测到的 ip6tables 二进制
    let hasIptables = false;
    let hasIp6tables = false;
    let enableIPv6 = false;
    let pluginUninstalled = false;
    let ruleOwners = {};          // B2: { [addr]: mac } 规则归属台账（v4/v6 合一，按地址格式区分）
    let rulesAdopted = false;     // B2: 启动时是否已 adopt/清理过现有链
    let historyDirty = false;     // B8: 流量历史脏标记
    let lastHistorySave = 0;      // B8: 上次落盘时间
    let deviceLimits = {};        // v19.10.0: { mac: { up: KB/s, down: KB/s } }，0/缺省=不限
    let limitMode = null;         // v19.10.0: 'hashlimit'(精确) | 'limit'(近似) | null(不可用)
    let limitChainsMounted = false; // v19.10.0: 限速链是否已挂载
    let _warnedAbnormal = {};       // v20.1.6(K1): 异常流量 WARN 已记台账 {mac@量级: true}，同一设备同一量级只记一次

    // ============================================================
    //  v21.0.0: 统计引擎 (kano_engine) —— 后台 C 二进制直读 conntrack + sysfs
    //  引擎在线时以其 JSON 为准(内核精确记账, 页面关闭期间持续统计);
    //  引擎未安装/掉线时自动回退原 iptables 计数链(链保持同步作热备份, 回退无缝)
    // ============================================================
    const ENGINE_BIN = '/data/data/com.minikano.f50_sms/kano_engine';
    const ENGINE_JSON = '/data/data/com.minikano.f50_sms/kano_engine.json';
    const ENGINE_VER = '/data/data/com.minikano.f50_sms/kano_engine.ver';
    const ENGINE_PID = '/data/data/com.minikano.f50_sms/kano_engine.pid';
    const ENGINE_CMD = '/data/data/com.minikano.f50_sms/kano_engine.cmd';
    const ENGINE_LOG = '/data/data/com.minikano.f50_sms/kano_engine.log'; // v21.0.1(Q2): 引擎 stdout/stderr 落盘, 排障用
    const ENGINE_BOOT_FILE = '/sdcard/ufi_tools_boot.sh';
    const ENGINE_BOOT_LINE = `nohup ${ENGINE_BIN} >>${ENGINE_LOG} 2>&1 &`; // v21.0.1(Q2): 输出进日志, 不再丢 /dev/null
    const ENGINE_MANIFEST_URL = 'https://cdn.jsdelivr.net/gh/468133/kano-engine-assets@main/latest.json';

    let _engineJsonCache = { t: 0, data: null }; // data=null = 引擎不可用(未安装/掉线/JSON过期)
    let _engineUpdateNotified = false;           // v21.0.0(P5): 云端新版本 toast 每会话只提示一次

    // 读取引擎 JSON(1.2s 缓存, 同一 tick 内 fetchDevs/updateStats 共享一次 shell)
    // 新鲜度用设备侧文件 mtime 判定(浏览器与路由器时钟可能不一致, 不能用页面 Date.now())
    const readEngineJson = async (force) => {
        const nowT = Date.now();
        if (!force && nowT - _engineJsonCache.t < 1200) return _engineJsonCache.data;
        _engineJsonCache.t = nowT;
        try {
            const r = await _shUser(`now=$(date +%s); mt=$(stat -c %Y ${ENGINE_JSON} 2>/dev/null || echo 0); if [ $((now - mt)) -lt 30 ]; then timeout 2s awk '{print}' ${ENGINE_JSON} 2>/dev/null; fi`);
            const raw = _sh(r).trim();
            if (!raw) { _engineJsonCache.data = null; return null; }
            const j = JSON.parse(raw);
            if (!j || !j.devices) { _engineJsonCache.data = null; return null; }
            _engineJsonCache.data = j;
            return j;
        } catch (e) { _engineJsonCache.data = null; return null; }
    };

    // v21.0.1(Q1): 进程活性判定统一口径 —— pid文件 + kill -0 + 非僵尸(/proc/<pid>/stat 第3字段)
    // 旧口径只看 pid文件+kill -0: 引擎启动即崩溃时 pid文件残留、僵尸仍响应 kill -0 → 误报运行中
    const ENGINE_ALIVE_SH = `p=$(cat ${ENGINE_PID} 2>/dev/null); [ -n "$p" ] && kill -0 $p 2>/dev/null && [ "$(awk '{print $3}' /proc/$p/stat 2>/dev/null)" != "Z" ]`;

    // 启动引擎(幂等) + 写入开机自启行(幂等, 每次重写防旧格式残留); conntrack 记账引擎自身也会开, 这里双保险
    const startEngine = async () => {
        const cmd = `[ -x ${ENGINE_BIN} ] || chmod 777 ${ENGINE_BIN} 2>/dev/null; ` +
            `printf '1' > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null || true; ` +
            `if ${ENGINE_ALIVE_SH}; then echo ENGINE_RUNNING; else ` +
            `rm -f ${ENGINE_PID}; ` +
            `[ $(stat -c %s ${ENGINE_LOG} 2>/dev/null || echo 0) -gt 131072 ] && tail -c 65536 ${ENGINE_LOG} > ${ENGINE_LOG}.tmp 2>/dev/null && mv ${ENGINE_LOG}.tmp ${ENGINE_LOG}; ` + // Q2: 日志超128KB截断
            `nohup ${ENGINE_BIN} >>${ENGINE_LOG} 2>&1 & sleep 2; ` +
            `if ${ENGINE_ALIVE_SH}; then echo ENGINE_STARTED; else echo ENGINE_STARTFAIL; echo '-- 引擎日志尾部 --'; tail -c 1500 ${ENGINE_LOG} 2>/dev/null; fi; fi; ` +
            `sed -i '\\#${ENGINE_BIN}#d' ${ENGINE_BOOT_FILE} 2>/dev/null; touch ${ENGINE_BOOT_FILE} 2>/dev/null; printf '%s\\n' '${ENGINE_BOOT_LINE}' >> ${ENGINE_BOOT_FILE}`;
        const r = await runShellWithRoot(cmd);
        _logCmd('启动引擎', cmd, r);
        const out = _sh(r);
        if (out.includes('ENGINE_STARTFAIL')) _log('ERR', '引擎启动失败: 进程未存活(可能启动即崩溃), 日志尾部见上条 CMD 输出, 或点「🔍 引擎自检」定位');
        return out.includes('ENGINE_RUNNING') || out.includes('ENGINE_STARTED');
    };

    // 停止引擎; removeBoot=true 时一并摘除开机自启行(用户主动停止/卸载)
    // v21.0.1(Q4): TERM 后轮询最多 6s 等优雅退出(引擎退出会自删 pid 并落最后一次 JSON),
    //              仍不死再 KILL, 最后必删 pid 文件 —— 杜绝残留 pid + 僵尸导致的"假运行"
    const stopEngine = async (removeBoot) => {
        const cmd = `if [ -f ${ENGINE_PID} ]; then kill $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; fi; ` +
            `i=0; while [ $i -lt 6 ]; do ${ENGINE_ALIVE_SH} || break; sleep 1; i=$((i+1)); done; ` +
            `if ${ENGINE_ALIVE_SH}; then kill -9 $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; sleep 1; fi; ` +
            `rm -f ${ENGINE_PID}; ` +
            (removeBoot ? `sed -i '\\#${ENGINE_BIN}#d' ${ENGINE_BOOT_FILE} 2>/dev/null || true; ` : '') +
            `echo ENGINE_STOPPED`;
        const r = await runShellWithRoot(cmd);
        _logCmd('停止引擎', cmd, r);
        _engineJsonCache = { t: 0, data: null };
    };

    // v21.0.2(R3): 单独卸载引擎 —— 停引擎+摘自启行+删引擎全部文件;
    // 插件数据(traffic_*)/历史/统计完全不动, 统计自动回退 iptables 计数链
    const uninstallEngine = async () => {
        await stopEngine(true);
        await _shUser(`rm -f ${ENGINE_BIN} ${ENGINE_BIN}.new ${ENGINE_JSON} ${ENGINE_JSON}.tmp ${ENGINE_VER} ${ENGINE_PID} ${ENGINE_CMD} ${ENGINE_LOG} ${ENGINE_LOG}.tmp /data/data/com.minikano.f50_sms/.kano_engine.b64 /data/data/com.minikano.f50_sms/.kano_deploy.b64`);
        _engineJsonCache = { t: 0, data: null };
        _log('ACTION', '卸载统计引擎(仅引擎, 插件数据保留)');
        createToast('引擎已卸载，统计已回退 iptables 计数链', 'green', 4000);
    };

    // jsDelivr 在国内部分网络/运营商下 DNS 污染或被阻断 —— 国内镜像(cdn.jsdmirror.com/jsd.onmicrosoft.cn,
    // 热点流量监控2.0同款优先节点) + jsDelivr 4 节点 + GitHub 代理 2 节点轮询; 设备 curl 为主, 浏览器为辅
    const ENGINE_CDN_HOSTS = ['cdn.jsdmirror.com', 'jsd.onmicrosoft.cn', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net'];
    const ENGINE_GH_PROXIES = ['https://ghfast.top/', 'https://ghproxy.net/'];

    // 将 jsDelivr URL 展开为全部候选源(国内镜像+jsDelivr 4节点 + ghfast/ghproxy 代理的 raw.githubusercontent 2节点)
    // v21.0.2(R5): rawFirst=true 时代理 raw 源排在最前 —— 清单类小文件 freshness 优先,
    // jsDelivr @main 有 PoP 缓存(仓库更新后可长达 12h 仍旧), raw 代理直连 GitHub 即时生效
    const assetCandidates = (url, rawFirst) => {
        const out = [];
        const m = String(url).match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/);
        const raws = [];
        if (m) {
            const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
            for (const p of ENGINE_GH_PROXIES) raws.push(p + raw);
        }
        if (rawFirst) out.push(...raws);
        for (const h of ENGINE_CDN_HOSTS) out.push(String(url).replace('cdn.jsdelivr.net', h));
        if (!rawFirst) out.push(...raws);
        return out;
    };

    const fetchTextMulti = async (url, rawFirst) => {
        for (const u of assetCandidates(url, rawFirst)) {
            try {
                const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
                if (r && r.ok) return await r.text();
            } catch (e) {}
        }
        return null;
    };

    // 设备侧 curl 下载文本(经路由器自身 WAN, 热点流量监控2.0同款通道) —— shell for 循环逐源尝试,
    // 成功输出 __SRC_OK__ 标记 + 内容; 显式传 90s 超时(API 默认超时短, 多源轮询会被掐死导致空输出)
    // v21.0.2(R5): 每个 URL 追加 ?t=时间戳穿透 CDN 缓存(治"仓库已更新仍检测到旧版本")
    const deviceFetchText = async (url, rawFirst) => {
        const cands = assetCandidates(url, rawFirst);
        const urls = cands.map(u => `'${u}'`).join(' ');
        const CURL = '/data/data/com.minikano.f50_sms/files/curl';
        const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; [ -x "$C" ] || which $C >/dev/null 2>&1 || echo NOCURL; ` +
            `ts=$(date +%s); for u in ${urls}; do out=$($C -fsSL --connect-timeout 8 --max-time 20 "$u?t=$ts" 2>/dev/null) && [ -n "$out" ] && { printf '__SRC_OK__\n%s' "$out"; break; }; echo "SRCFAIL $u"; done`;
        const r = await runShellWithRoot(cmd, 90000);
        const out = _sh(r);
        const m = out.match(/__SRC_OK__\n([\s\S]*)$/);
        return {
            text: m ? m[1].trim() : '',
            fails: (out.match(/SRCFAIL/g) || []).length,
            total: cands.length,
            nocurl: out.includes('NOCURL'),
            raw: out
        };
    };

    // 云端清单: {rev, guard(二进制b64), deploy(部署脚本b64), md5, notes}
    // 设备 curl 优先(热点流量监控2.0同款通道 —— 实测本环境浏览器 WebView 6 源全 Failed to fetch),
    // 浏览器 fetch 为辅; 每一步结果落盘日志, 失败时从日志即可看出卡在哪一侧
    const fetchManifest = async () => {
        try {
            const d = await deviceFetchText(ENGINE_MANIFEST_URL, true); // v21.0.2(R5): 清单 raw 优先, 穿透 jsDelivr 缓存
            if (d.text) {
                try { const j = JSON.parse(d.text); if (j && j.rev && j.guard) return j; } catch (e) {}
                _log('ENGINE', '云端清单: 设备侧下载成功但解析失败(源被劫持?)，尝试浏览器侧');
            } else {
                _log('ENGINE', `云端清单: 设备侧失败 SRCFAIL=${d.fails}/${d.total}${d.nocurl ? ' 设备无curl命令' : ''}，尝试浏览器侧`);
            }
        } catch (e) { _log('ENGINE', `云端清单: 设备侧异常 ${e && e.message || e}，尝试浏览器侧`); }
        const txt = await fetchTextMulti(ENGINE_MANIFEST_URL, true); // v21.0.2(R5): 清单 raw 优先
        if (txt) {
            try { const j = JSON.parse(txt); if (j && j.rev && j.guard) { _log('ENGINE', '云端清单: 浏览器侧获取成功'); return j; } } catch (e) {}
            _log('ENGINE', '云端清单: 浏览器下载成功但解析失败');
        } else {
            _log('ENGINE', `云端清单: 浏览器 ${assetCandidates(ENGINE_MANIFEST_URL).length} 源也全部失败`);
        }
        return null;
    };

    // 部署主路径: 页面 fetch jsDelivr 拿 base64 → 分块写设备 → base64 -d → ELF/md5 校验 → chmod → 就位
    const deployEngine = async (manifest) => {
        const text = await fetchTextMulti(manifest.guard); // 多 CDN 节点轮询
        if (text === null) throw new Error('浏览器侧全部 CDN 节点下载失败');
        const b64 = text.replace(/\s+/g, '');
        if (b64.length < 500 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('下载内容不是有效 base64');
        const tmp = '/data/data/com.minikano.f50_sms/.kano_engine.b64';
        await _shUser(`rm -f ${tmp}`);
        for (let i = 0; i < b64.length; i += 12000) {
            const chunk = b64.slice(i, i + 12000); // base64 字符集无单引号, 可直接 printf
            const wr = await _shUser(`printf '%s' '${chunk}' >> ${tmp}`);
            if (wr && wr.success === false) { await _shUser(`rm -f ${tmp}`); throw new Error('写入设备失败'); }
        }
        const md5 = String(manifest.md5 || '').toLowerCase();
        const checkMd5 = /^[0-9a-f]{32}$/.test(md5) && !/^0+$/.test(md5); // 全零占位 = 跳过校验
        const cmd = `base64 -d ${tmp} > ${ENGINE_BIN}.new 2>/dev/null || busybox base64 -d ${tmp} > ${ENGINE_BIN}.new 2>/dev/null; ` +
            `rm -f ${tmp}; ` +
            `head -c 4 ${ENGINE_BIN}.new 2>/dev/null | grep -q ELF || { echo DEPLOY_FAIL_NOT_ELF; rm -f ${ENGINE_BIN}.new; exit 0; }; ` +
            (checkMd5 ? `m=$(md5sum ${ENGINE_BIN}.new 2>/dev/null | awk '{print $1}'); [ "$m" = '${md5}' ] || { echo DEPLOY_FAIL_MD5; rm -f ${ENGINE_BIN}.new; exit 0; }; ` : '') +
            `chmod 777 ${ENGINE_BIN}.new; mv -f ${ENGINE_BIN}.new ${ENGINE_BIN}; printf '%s' '${manifest.rev}' > ${ENGINE_VER}; echo DEPLOY_OK`;
        const r = await runShellWithRoot(cmd);
        _logCmd('引擎部署', cmd, r);
        const out = _sh(r);
        if (out.includes('DEPLOY_FAIL_MD5')) throw new Error('MD5 校验失败');
        if (out.includes('DEPLOY_FAIL_NOT_ELF')) throw new Error('解码后不是有效可执行文件');
        if (!out.includes('DEPLOY_OK')) throw new Error('设备安装失败');
    };

    // 部署主路径: 设备 curl 拉部署脚本执行(热点流量监控2.0同款通道, 该设备已验证可用)
    const deployEngineOnDevice = async (manifest) => {
        if (!manifest.deploy) throw new Error('云端清单缺少 deploy 地址');
        const CURL = '/data/data/com.minikano.f50_sms/files/curl';
        const tmp = '/data/data/com.minikano.f50_sms/.kano_deploy.b64';
        const urls = assetCandidates(manifest.deploy).map(u => `'${u}'`).join(' ');
        const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; ` +
            `for u in ${urls}; do $C -fsSL --connect-timeout 8 --max-time 30 "$u" -o ${tmp} && [ -s ${tmp} ] && break; done; ` +
            `[ -s ${tmp} ] && ` +
            `(base64 -d ${tmp} 2>/dev/null || busybox base64 -d ${tmp} 2>/dev/null) > ${tmp}.sh && sh ${tmp}.sh && echo DEVICE_DEPLOY_OK || echo DEVICE_DEPLOY_FAIL; ` +
            `rm -f ${tmp} ${tmp}.sh`;
        const r = await runShellWithRoot(cmd, 120000);
        _logCmd('引擎部署(设备侧)', cmd, r);
        if (!_sh(r).includes('DEVICE_DEPLOY_OK')) throw new Error('设备侧下载部署失败');
    };

    // 一键安装/更新编排: 设备侧为主(热点流量监控2.0同款通道), 浏览器中转为辅, 成功后重启引擎生效
    const installOrUpdateEngine = async () => {
        const manifest = await fetchManifest();
        if (!manifest) { createToast('无法获取云端清单(检查网络/DNS)', 'red', 4000); _log('ENGINE', '获取云端清单失败'); return false; }
        try {
            await deployEngineOnDevice(manifest);
        } catch (e) {
            _log('ENGINE', `设备侧部署失败(${e && e.message || e})，改试浏览器中转`);
            try { await deployEngine(manifest); }
            catch (e2) { createToast('引擎部署失败: ' + (e2 && e2.message || e2), 'red', 5000); _log('ERR', `引擎部署失败: ${e2 && e2.message || e2}`); return false; }
        }
        await stopEngine(false);
        const ok = await startEngine();
        _engineJsonCache = { t: 0, data: null };
        _log('ENGINE', `引擎 v${manifest.rev} 部署完成${ok ? '，已启动' : '，启动结果待确认'}`);
        createToast(`统计引擎 v${manifest.rev} 部署完成`, 'green', 4000);
        return true;
    };

    // 版本检查: interactive=false 为静默检查(已安装且有新版时 toast 一次), 返回 {manifest, local, newer}
    const checkEngineUpdate = async (interactive) => {
        const manifest = await fetchManifest();
        if (!manifest) { if (interactive) createToast('无法获取云端清单', 'red', 3000); return null; }
        let local = '';
        try { const r = await _shUser(`awk '{print}' ${ENGINE_VER} 2>/dev/null || echo ''`); local = _sh(r).trim(); } catch (e) {}
        const newer = local !== manifest.rev;
        if (newer && local && !interactive && !_engineUpdateNotified) {
            _engineUpdateNotified = true;
            createToast(`统计引擎有新版本 v${manifest.rev}(当前 v${local})，点「🛠️ 引擎」一键更新`, 'pink', 6000);
        }
        _log('ENGINE', `云端版本 v${manifest.rev} 本地 ${local || '未安装'}${newer ? ' → 可更新' : ' → 已是最新'}`);
        return { manifest, local, newer };
    };

    // v21.0.2(R4): 插件自身云端自更新(热点流量监控2.0同款机制) ——
    // 下载 js b64(设备curl主/浏览器辅) → 解码 → 校验身份标识 → getCustomHead 找到本插件块
    // → setCustomHead 原位替换 → 2s 后刷新页面生效。任何一步失败都不破坏现状, 手动导入文件仍是兜底
    const updatePluginSelf = async (manifest) => {
        try {
            if (!manifest || !manifest.js) throw new Error('云端清单缺少插件(js)地址');
            if (typeof getCustomHead !== 'function' || typeof setCustomHead !== 'function') throw new Error('当前 UFI-TOOLS 不支持插件自更新，请手动导入新插件文件');
            _log('ENGINE', `插件自更新: 本机 v${PLUGIN_VERSION} → 云端 v${manifest.jsRev || '?'}，开始下载`);
            _refreshing = true; // T1: 下载/读回期间暂停监控tick, 独占shell通道
            // v21.0.4(T1): 大文件改"设备侧 curl 落盘 + 分块读回" —— 旧路径整包走 shell stdout,
            //              ~350KB 被宿主掐死返回空(长度0); 每块8KB单条shell秒回, 长度校验防读漏
            let b64 = '';
            const tmpf = '/data/data/com.minikano.f50_sms/.kano_plugin.b64';
            const dlUrls = assetCandidates(manifest.js, true).map(u => `'${u}'`).join(' ');
            const CURLB = '/data/data/com.minikano.f50_sms/files/curl';
            const dlCmd = `C=curl; [ -x ${CURLB} ] && C=${CURLB}; rm -f ${tmpf}; ts=$(date +%s); for u in ${dlUrls}; do $C -fsSL --connect-timeout 8 --max-time 40 "$u?t=$ts" -o ${tmpf} && [ -s ${tmpf} ] && break; done; [ -s ${tmpf} ] && stat -c %s ${tmpf} || echo 0`;
            const dlr = await runShellWithRoot(dlCmd, 120000);
            _logCmd('插件包下载(设备侧落盘)', dlCmd, dlr);
            const dlsz = parseInt(_sh(dlr), 10) || 0;
            if (dlsz > 0) {
                for (let off = 0; off < dlsz; off += 8000) {
                    const cr = await runShellWithRoot(`tail -c +${off + 1} ${tmpf} | head -c 8000`);
                    b64 += _sh(cr).replace(/\s+/g, '');
                }
                await _shUser(`rm -f ${tmpf}`);
                if (b64.length < dlsz - 2) { _log('ERR', `插件包读回不完整 ${b64.length}/${dlsz}`); b64 = ''; }
            }
            if (!b64) { const t = await fetchTextMulti(manifest.js, true); if (t) b64 = t; } // 浏览器兜底
            b64 = String(b64).replace(/\s+/g, '');
            if (b64.length < 10000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('下载内容不是有效 base64(长度 ' + b64.length + ')');
            let newJs;
            try { newJs = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }
            catch (e) { throw new Error('插件文件解码失败: ' + (e && e.message || e)); }
            if (!newJs.includes(_SIG)) throw new Error('下载的插件缺少身份标识，可能被劫持或拿错文件，已中止');
            const head = await getCustomHead();
            if (!head) throw new Error('读取插件列表失败');
            const escRe = s => s.replace(/[\[\]]/g, '\\$&');
            const re = new RegExp(escRe(_PS) + '\\s*(.*?)\\s*-->([\\s\\S]*?)' + escRe(_PE) + '\\s*\\1\\s*-->', 'g');
            let found = false, newText = head, m;
            while ((m = re.exec(head)) !== null) {
                if (m[2].includes(_SIG)) {
                    newText = head.replace(m[0], () => `${_PS} ${m[1].trim()} -->\n${newJs}\n${_PE} ${m[1].trim()} -->`);
                    found = true;
                    break;
                }
            }
            if (!found) throw new Error('插件列表中未找到本插件标识，请先手动导入 v21.0.2 文件一次，之后即可自更新');
            let saved = false, lastErr = null;
            for (let i = 0; i < 3 && !saved; i++) {
                try {
                    const r = await setCustomHead(newText);
                    saved = !!(r && r.result === 'success');
                    if (!saved) lastErr = new Error('保存返回: ' + JSON.stringify(r).slice(0, 120));
                } catch (e) { lastErr = e; }
            }
            if (!saved) throw lastErr || new Error('保存插件列表失败');
            _refreshing = false;
            _log('ACTION', `插件已自更新到 v${manifest.jsRev || '?'}，页面即将刷新`);
            createToast('插件已更新到 v' + (manifest.jsRev || '?') + '，2秒后刷新页面', 'green', 3000);
            setTimeout(() => location.reload(), 2000);
            return true;
        } catch (e) {
            _refreshing = false;
            createToast('插件更新失败: ' + (e && e.message || e), 'red', 6000);
            _log('ERR', `插件自更新失败: ${e && e.message || e}`);
            return false;
        }
    };

    // 引擎状态采集(管理弹窗/诊断共用), key=value 行解析
    const getEngineStatus = async () => {
        const st = { installed: false, running: false, ver: '', binSize: 0, jsonAge: -1, acct: 'na', boot: false, md5: '' };
        try {
            const r = await runShellWithRoot(
                `echo installed=$([ -x ${ENGINE_BIN} ] && echo 1 || echo 0); ` +
                `echo size=$(stat -c %s ${ENGINE_BIN} 2>/dev/null || echo 0); ` +
                `echo ver=$(awk '{print}' ${ENGINE_VER} 2>/dev/null); ` +
                `if ${ENGINE_ALIVE_SH}; then echo running=1; else echo running=0; fi; ` +
                `echo age=$(( $(date +%s) - $(stat -c %Y ${ENGINE_JSON} 2>/dev/null || echo 0) )); ` +
                `echo acct=$(awk '{print}' /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null || echo na); ` +
                `echo md5=$(md5sum ${ENGINE_BIN} 2>/dev/null | awk '{print $1}'); ` +
                `grep -qxF '${ENGINE_BOOT_LINE}' ${ENGINE_BOOT_FILE} 2>/dev/null && echo boot=1 || echo boot=0`
            );
            const kv = {};
            for (const line of _sh(r).split('\n')) {
                const m = line.match(/^\s*(installed|size|ver|running|age|acct|boot|md5)=(.*)$/);
                if (m) kv[m[1]] = m[2].trim();
            }
            st.installed = kv.installed === '1';
            st.running = kv.running === '1';
            st.boot = kv.boot === '1';
            st.ver = kv.ver || '';
            st.binSize = parseInt(kv.size) || 0;
            st.jsonAge = kv.age !== undefined ? parseInt(kv.age) : -1;
            st.acct = kv.acct || 'na';
            st.md5 = kv.md5 || '';
        } catch (e) {}
        return st;
    };

    // ============================================================
    //  数据持久化
    // ============================================================

    const _sh = (r) => {
        if (!r) return '';
        if (typeof r === 'string') return r;
        if (typeof r.content === 'string') return r.content;
        if (r.content && typeof r.content === 'object') {
            if (typeof r.content.content === 'string') return r.content.content;
            if (r.content.content !== undefined) return String(r.content.content);
            for (const key of ['content', 'output', 'result', 'data', 'stdout', 'message']) {
                if (typeof r.content[key] === 'string') return r.content[key];
            }
            return String(r.content);
        }
        for (const key of ['content', 'output', 'result', 'data', 'stdout', 'message']) {
            if (typeof r[key] === 'string') return r[key];
            if (r[key] && typeof r[key][key] === 'string') return r[key][key];
        }
        return String(r.content || r.result || r.output || r.data || '');
    };

    // v19.10.0: 此处原有 shell 输出兜底辅助函数已删除（全文件 0 调用，dead code）

    const _escEcho = (s) => s.replace(/'/g, "'\\''");

    // v20.0.1(F2): /api/user_shell 在部分设备上 500 → 文件读写统一走此包装，失败自动回退 root shell
    let _userShellBroken = false;
    const _shUser = async (cmd) => {
        if (!_userShellBroken && typeof runShellWithUser === 'function') {
            try {
                const r = await runShellWithUser(cmd);
                if (r && r.success !== false) return r;
                _userShellBroken = true;
                console.warn('[设备流量监控] user_shell 接口异常(500)，本会话文件读写已回退 root shell');
            } catch (e) { _userShellBroken = true; }
        }
        return await runShellWithRoot(cmd);
    };

    // v20.0.1(F4): 高级功能(root)前置校验（规范：root 操作前必须验证高级功能已启用）
    const _hasRoot = async () => {
        try { const r = await runShellWithRoot('whoami'); return _sh(r).includes('root'); } catch (e) { return false; }
    };

    // v20.3.0(M1): 弱口令检测已按用户要求彻底移除 —— 危险操作统一由防呆确认兜底
    // (卸载连点5次 / 清除全部流量连点2次 / 删除数据文件需主动勾选 / 清除日志连点2次 / 回添归档弹窗确认)

    // iptables 二进制探测：iptables / iptables-legacy / iptables-nft，取第一个可用
    const detectIptables = async () => {
        IPT = '';
        hasIptables = false;
        for (const bin of ['iptables', 'iptables-legacy', 'iptables-nft']) {
            try {
                const r = await runShellWithRoot(`${bin} -t mangle -L -n 2>/dev/null && echo IPT_OK || echo IPT_NO`);
                if (_sh(r).includes('IPT_OK')) { IPT = bin; hasIptables = true; break; }
            } catch (e) {}
        }
        console.log('[设备流量监控] iptables:', hasIptables ? IPT : '不可用');
        if (!hasIptables) {
            createToast('未检测到可用的 iptables，流量统计功能不可用', 'red', 5000);
        }
    };

    // ip6tables 二进制探测：ip6tables / ip6tables-legacy / ip6tables-nft
    const detectIp6tables = async () => {
        IP6T = '';
        hasIp6tables = false;
        for (const bin of ['ip6tables', 'ip6tables-legacy', 'ip6tables-nft']) {
            try {
                const r = await runShellWithRoot(`${bin} -t mangle -L -n 2>/dev/null && echo IP6OK || echo IP6NO`);
                if (_sh(r).includes('IP6OK')) { IP6T = bin; hasIp6tables = true; break; }
            } catch (e) {}
        }
        console.log('[设备流量监控] ip6tables:', hasIp6tables ? IP6T : '不可用');
    };

    const saveToFile = async (file, data) => {
        try {
            const json = JSON.stringify(data);
            const bak = file + '.bak';
            // v20.0.1(F6): echo 改 printf '%s'，避免 busybox echo 解释反斜杠转义导致 JSON 损坏
            let r = await _shUser(`printf '%s' '${_escEcho(json)}' > ${file}`);
            if (!r.success) {
                r = await _shUser(`busybox printf '%s' '${_escEcho(json)}' > ${file}`);
                if (!r.success) return false;
            }
            const verify = await loadFromFile(file);
            if (!verify) return false;
            await _shUser(`printf '%s' '${_escEcho(json)}' > ${bak}`);
            return true;
        } catch (e) {
            console.error('[设备流量监控] 保存异常:', e);
            return false;
        }
    };

    const loadFromFile = async (file) => {
        let content = await _readFileRaw(file);
        if (!content) {
            content = await _readFileRaw(file + '.bak');
            if (content) console.log('[设备流量监控] 从备份恢复:', file);
        }
        if (!content) return null;
        try { return JSON.parse(content); } catch (e) { return null; }
    };

    const _readFileRaw = async (file) => {
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${file}`);
            const c = _sh(r).trim();
            return c || null;
        } catch (e) { return null; }
    };

    const loadData = async () => {
        const h = await loadFromFile(STORAGE_FILE);
        if (h) trafficHistory = h;
        const n = await loadFromFile(NAMES_FILE);
        if (n) customNames = n;
        const s = await loadFromFile(SNAPSHOTS_FILE);
        if (s) snapshots = s;
        const l = await loadFromFile(LIMITS_FILE); // v19.10.0: 限速配置
        if (l) deviceLimits = l;
    };

    const saveSnapshots = async () => saveToFile(SNAPSHOTS_FILE, snapshots);
    const saveHistory = async () => saveToFile(STORAGE_FILE, trafficHistory);
    const saveNames = async () => saveToFile(NAMES_FILE, customNames);
    const saveLimits = async () => saveToFile(LIMITS_FILE, deviceLimits);

    // B8: 写盘节流 —— dirty 标记 + force 强制落盘
    const flushHistory = async (force) => {
        if (!force && !historyDirty) return false;
        const ok = await saveHistory();
        if (ok) { historyDirty = false; lastHistorySave = Date.now(); }
        return ok;
    };

        // ============================================================
    //  日志系统 (v20.0.0 新增)
    // ============================================================
    const DEBUG_LOG_FILE = '/data/data/com.minikano.f50_sms/traffic_debug.log';
    const MAX_LOG_LINES = 200;

    let _lastLogKey = ''; // v20.1.6(K1): 相邻同内容日志去重 —— 监控 tick 里重复触发的同一日志只写一条，防刷爆 200 条上限
    const _log = async (tag, msg) => {
        const key = `[${tag}] ${msg}`; // 时间戳每秒都变，去重只按内容；中间夹了别的日志后同内容可再记
        if (key === _lastLogKey) return;
        _lastLogKey = key;
        const line = `[${new Date().toLocaleString()}] [${tag}] ${msg}`;
        try {
            await _shUser(
                `printf '%s\n' '${_escEcho(line)}' >> ${DEBUG_LOG_FILE}; ` +
                `tail -n ${MAX_LOG_LINES} ${DEBUG_LOG_FILE} > ${DEBUG_LOG_FILE}.tmp 2>/dev/null; ` +
                `mv ${DEBUG_LOG_FILE}.tmp ${DEBUG_LOG_FILE} 2>/dev/null; true`
            );
        } catch(e) {}
    };

    // v20.4.0(N5): 控制台式命令日志 —— 关键 shell 操作记录 "$ 命令 ⇒ 输出(截断)"，出错时能直接看到哪条命令、返回了什么
    const _logCmd = async (tag, cmd, result) => {
        try {
            let out = _sh(result) || '';
            out = out.replace(/\n/g, ' ⏎ ');
            if (out.length > 200) out = out.slice(0, 200) + '…[截断]';
            let c = String(cmd);
            if (c.length > 600) c = c.slice(0, 600) + ' …[命令过长已截断]';
            await _log('CMD', `[${tag}] $ ${c}${out ? ' ⇒ ' + out : ' ⇒ (无输出/成功)'}`);
        } catch (e) {}
    };

    // v20.1.0(G3): 日志按时长保留 —— 超过 N 天的行自动清除(默认7天,设置中可改; 0=不按时长清理)
    const cleanOldLogs = async () => {
        const days = parseInt(archiveSettings.logRetentionDays);
        if (!(days > 0)) return;
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${DEBUG_LOG_FILE} 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw.trim()) return;
            const lines = raw.split('\n');
            const cutoff = Date.now() - days * 86400000;
            const kept = lines.filter(line => {
                const m = line.match(/^\[(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\]/);
                if (!m) return true; // 无法解析时间的行保留
                const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
                return ts >= cutoff;
            });
            if (kept.length === lines.length) return;
            await _shUser(`printf '%s' '${_escEcho(kept.join('\n'))}' > ${DEBUG_LOG_FILE}`);
            console.log('[设备流量监控] 日志清理: 删除', lines.length - kept.length, '条过期日志, 保留', kept.length, '条');
        } catch (e) {}
    };

    const readLogFile = async () => {
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${DEBUG_LOG_FILE} 2>/dev/null || echo ''`);
            return _sh(r).trim() || '(暂无日志)';
        } catch(e) { return '(读取日志失败)'; }
    };

    const showLogModal = async () => {
        if (pluginUninstalled) return;
        const logText = await readLogFile();
        const { id, el } = createModal({
            name: 'traffic_log_modal', title: '📋 运行日志', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;">最近 ${MAX_LOG_LINES} 条日志记录</div>
                <textarea readonly style="width:100%;height:45vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">${escHtml(logText)}</textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">
                    <button id="kano_log_clear" style="font-size:11px;padding:4px 12px;background:rgba(255,107,107,0.12);border:1px solid rgba(255,107,107,0.25);border-radius:4px;color:#ff6b6b;cursor:pointer;">清除日志</button>
                    <button id="kano_log_refresh" style="font-size:11px;padding:4px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:inherit;cursor:pointer;">刷新</button>
                    <button id="kano_log_copy" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
                </div>`
        });
        showModal(id);
        setTimeout(() => {
            const ta = el.querySelector('textarea');
            if (ta) ta.scrollTop = ta.scrollHeight;
            el.querySelector('#kano_log_refresh')?.addEventListener('click', async () => {
                const refreshed = await readLogFile();
                const t = el.querySelector('textarea');
                if (t) { t.value = refreshed; t.scrollTop = t.scrollHeight; }
            });
            // v20.2.0(L3): 清除日志 —— 按钮双击确认(3s内第二次点击生效)，清空后写一条 ACTION 便于追溯
            const clearBtn = el.querySelector('#kano_log_clear');
            let logClearArmed = false, logClearTimer = null;
            clearBtn?.addEventListener('click', async () => {
                if (!logClearArmed) {
                    logClearArmed = true;
                    clearBtn.textContent = '确认清除？';
                    if (logClearTimer) clearTimeout(logClearTimer);
                    logClearTimer = setTimeout(() => { logClearArmed = false; clearBtn.textContent = '清除日志'; }, 3000);
                    return;
                }
                logClearArmed = false;
                if (logClearTimer) clearTimeout(logClearTimer);
                clearBtn.textContent = '清除日志';
                try { await _shUser(`: > ${DEBUG_LOG_FILE}`); } catch(e) {}
                _lastLogKey = ''; // 去重台账随文件一起重置
                await _log('ACTION', '日志已手动清除');
                const t = el.querySelector('textarea');
                if (t) t.value = await readLogFile();
                createToast('日志已清除', 'green');
            });
            el.querySelector('#kano_log_copy')?.addEventListener('click', async () => {
                const t = el.querySelector('textarea');
                if (!t) return;
                // v20.0.2(F8) 降级复制；v20.1.2(H3) 提取为 copyTextSafe
                const ok = await copyTextSafe(t.value, t);
                createToast(ok ? '日志已复制' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 4000);
            });
        }, 100);
    };

// B5: 显式转义 & < > " ' （修复属性注入逃逸）
    const escHtml = (t) => String(t ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // v20.1.2(H3): 通用复制 —— 剪贴板API优先，http页面降级 select()+execCommand，返回是否成功
    const copyTextSafe = async (text, fallbackEl) => {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {}
        try {
            if (fallbackEl && fallbackEl.select) { fallbackEl.focus(); fallbackEl.select(); return document.execCommand('copy'); }
        } catch (e) {}
        return false;
    };

    // ============================================================
    //  iptables - IPv4（B3: 只挂 FORWARD）
    // ============================================================

    const _isV6Addr = (addr) => String(addr || '').includes(':');

    const initChain = async () => {
        if (!hasIptables) return;
        await runShellWithRoot(`${IPT} -t mangle -N ${CHAIN_NAME} 2>/dev/null || true`);
        await _cleanMounts();
        await runShellWithRoot(`${IPT} -t mangle -C FORWARD -j ${CHAIN_NAME} 2>/dev/null || ${IPT} -t mangle -I FORWARD 1 -j ${CHAIN_NAME}`);
    };

    const _cleanMounts = async () => {
        if (!hasIptables) return;
        // v19.8 曾在 POSTROUTING/INPUT 上按桥接接口(br0)硬编码插入 RETURN 规则，此处仅用于删除这些历史遗留规则
        const legacyIf = 'b' + 'r0';
        const cmds = [
            `${IPT} -t mangle -D FORWARD -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D POSTROUTING -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D INPUT -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D OUTPUT -j ${CHAIN_NAME} 2>/dev/null`,
            `${IPT} -t mangle -D POSTROUTING -o ${legacyIf} -j RETURN 2>/dev/null`,
            `${IPT} -t mangle -D INPUT -i ${legacyIf} -j RETURN 2>/dev/null`
        ];
        await runShellWithRoot(cmds.join('; ') + '; true');
    };

    // B2: 批量增规则（一次 shell 调用，;-连接；已存在则跳过）
    const addRulesBatch = async (addrs4, addrs6) => {
        if (addrs4.length && hasIptables) {
            try {
                const cmd = addrs4.map(ip =>
                    `${IPT} -t mangle -C ${CHAIN_NAME} -s ${ip} -j RETURN 2>/dev/null || ${IPT} -t mangle -A ${CHAIN_NAME} -s ${ip} -j RETURN; ` +
                    `${IPT} -t mangle -C ${CHAIN_NAME} -d ${ip} -j RETURN 2>/dev/null || ${IPT} -t mangle -A ${CHAIN_NAME} -d ${ip} -j RETURN`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('加规则v4', cmd, r); // v20.4.0(N5)
            } catch (e) {
                console.error('[设备流量监控] addRulesBatch v4 异常:', e);
                _log('ERR', `addRulesBatch v4 异常: ${e && e.message || e} addrs=[${addrs4.join(',')}]`); // v20.4.0(N5)
            }
        }
        if (addrs6.length && hasIp6tables && enableIPv6) {
            try {
                const cmd = addrs6.map(ip6 =>
                    `${IP6T} -t mangle -C ${CHAIN_NAME6} -s ${ip6} -j RETURN 2>/dev/null || ${IP6T} -t mangle -A ${CHAIN_NAME6} -s ${ip6} -j RETURN; ` +
                    `${IP6T} -t mangle -C ${CHAIN_NAME6} -d ${ip6} -j RETURN 2>/dev/null || ${IP6T} -t mangle -A ${CHAIN_NAME6} -d ${ip6} -j RETURN`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('加规则v6', cmd, r); // v20.4.0(N5)
            } catch (e) {
                console.error('[设备流量监控] addRulesBatch v6 异常:', e);
                _log('ERR', `addRulesBatch v6 异常: ${e && e.message || e} addrs=[${addrs6.join(',')}]`); // v20.4.0(N5)
            }
        }
    };

    // B2: 批量删规则（一次 shell 调用）
    const delRulesBatch = async (addrs4, addrs6) => {
        if (addrs4.length && hasIptables) {
            try {
                const cmd = addrs4.map(ip =>
                    `${IPT} -t mangle -D ${CHAIN_NAME} -s ${ip} -j RETURN 2>/dev/null; ` +
                    `${IPT} -t mangle -D ${CHAIN_NAME} -d ${ip} -j RETURN 2>/dev/null`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('删规则v4', cmd, r); // v20.4.0(N5)
            } catch (e) {
                console.error('[设备流量监控] delRulesBatch v4 异常:', e);
                _log('ERR', `delRulesBatch v4 异常: ${e && e.message || e} addrs=[${addrs4.join(',')}]`); // v20.4.0(N5)
            }
        }
        if (addrs6.length && hasIp6tables) {
            try {
                const cmd = addrs6.map(ip6 =>
                    `${IP6T} -t mangle -D ${CHAIN_NAME6} -s ${ip6} -j RETURN 2>/dev/null; ` +
                    `${IP6T} -t mangle -D ${CHAIN_NAME6} -d ${ip6} -j RETURN 2>/dev/null`
                ).join('; ');
                const r = await runShellWithRoot(cmd + '; true');
                _logCmd('删规则v6', cmd, r); // v20.4.0(N5)
            } catch (e) {
                console.error('[设备流量监控] delRulesBatch v6 异常:', e);
                _log('ERR', `delRulesBatch v6 异常: ${e && e.message || e} addrs=[${addrs6.join(',')}]`); // v20.4.0(N5)
            }
        }
    };

    // v20.0.1(F1): 删除指定设备的全部计数规则并清台账（showDeleteConfirm 调用；v20.0.0 缺失此定义，点确认必抛 ReferenceError）
    const delDevRules = async (mac) => {
        const dev = deviceList.find(d => d.mac === mac);
        const addrs4 = [], addrs6 = [];
        if (dev?.ip) addrs4.push(dev.ip);
        for (const a of (dev?.ip6s || [])) addrs6.push(a);
        if (!addrs4.length && !addrs6.length) return; // 离线设备无地址，规则台账本就没有
        for (const addr of [...addrs4, ...addrs6]) delete ruleOwners[addr];
        await delRulesBatch(addrs4, addrs6);
    };

    // 解析现有链规则中的非 any 地址（B2 启动 adopt/清理用）
    const listRuleAddrs = async (v6) => {
        const addrs = new Set();
        if (v6 ? !hasIp6tables : !hasIptables) return addrs;
        const bin = v6 ? IP6T : IPT;
        const chain = v6 ? CHAIN_NAME6 : CHAIN_NAME;
        const anyTok = v6 ? '::/0' : '0.0.0.0/0';
        try {
            const r = await runShellWithRoot(`${bin} -t mangle -nvxL ${chain} 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw) return addrs;
            for (const line of raw.split('\n')) {
                const l = line.trim();
                if (!l || l.startsWith('Chain') || l.startsWith('pkts') || !l.includes('RETURN')) continue;
                const p = l.split(/\s+/);
                if (p.length < 8) continue;
                const src = p[p.length - 2], dst = p[p.length - 1];
                if (src && src !== anyTok) addrs.add(src);
                if (dst && dst !== anyTok) addrs.add(dst);
            }
        } catch (e) {}
        return addrs;
    };

    // B2: 规则生命周期同步 —— 期望集合 = 当前 deviceList 全部 ip + 全部 ip6s
    const syncRules = async () => {
        if (pluginUninstalled) return;
        const v4ok = hasIptables;
        const v6ok = hasIp6tables && enableIPv6;
        if (!v4ok && !v6ok) return;

        const expected = {}; // addr -> mac
        for (const d of deviceList) {
            if (v4ok && d.ip) expected[d.ip] = d.mac;
            if (v6ok) for (const a of (d.ip6s || [])) expected[a] = d.mac;
        }

        const dels = [], adds = [];

        // 启动时：解析现有链规则，属于当前设备的 adopt(置 owner，不清零)，不属于的清理
        if (!rulesAdopted) {
            rulesAdopted = true;
            const existing = new Set([...(await listRuleAddrs(false)), ...(await listRuleAddrs(true))]);
            for (const addr of existing) {
                if (expected[addr]) ruleOwners[addr] = expected[addr];
                else dels.push(addr);
            }
            console.log('[设备流量监控] 规则adopt:', Object.keys(ruleOwners).length, '清理残留:', dels.length);
            _log('SYNC', `启动adopt 继承规则=${Object.keys(ruleOwners).length} 清理残留=${dels.length}`); // v20.1.0(G5)
        }

        // IP 换主（含不存在）→ 先删后建
        for (const [addr, mac] of Object.entries(expected)) {
            if (ruleOwners[addr] !== mac) { dels.push(addr); adds.push(addr); }
        }
        // 期望集合之外的 owner 条目 → 删除并移除 owner（失效临时 v6 地址随之清理）
        for (const addr of Object.keys(ruleOwners)) {
            if (!expected[addr]) dels.push(addr);
        }

        const delSet = [...new Set(dels)];
        const addSet = [...new Set(adds)];
        if (delSet.length === 0 && addSet.length === 0) return;

        // v20.3.0(M3): 删规则前补读一次计数器 —— 上次 tick 到删规则之间(最长一个刷新间隔)的流量
        // 先刷进台账基线，之后由 updateStats 的"计数器变小/地址出局"逻辑按新基线一次性补入，不再丢失
        if (delSet.length) {
            try {
                const need4 = delSet.some(a => !_isV6Addr(a));
                const need6 = delSet.some(a => _isV6Addr(a));
                const [c4, c6] = await Promise.all([need4 ? getCounters(false) : {}, need6 ? getCounters(true) : {}]);
                const all = { ...c4, ...c6 };
                let topped = 0;
                for (const addr of delSet) {
                    const mac = ruleOwners[addr] || expected[addr];
                    const h = mac && trafficHistory[mac];
                    if (!h || !all[addr]) continue;
                    h.addrUp = h.addrUp || {}; h.addrDown = h.addrDown || {};
                    // 取较大值防回退：只抬升基线，绝不降低(降基线会导致重复补计)
                    h.addrUp[addr] = Math.max(h.addrUp[addr] || 0, all[addr].up || 0);
                    h.addrDown[addr] = Math.max(h.addrDown[addr] || 0, all[addr].down || 0);
                    topped++;
                }
                if (topped) { historyDirty = true; _log('SYNC', `删规则前补读计数 addr=${topped}/${delSet.length}`); }
            } catch (e) {}
        }

        await delRulesBatch(delSet.filter(a => !_isV6Addr(a)), delSet.filter(a => _isV6Addr(a)));
        await addRulesBatch(addSet.filter(a => !_isV6Addr(a)), addSet.filter(a => _isV6Addr(a)));

        for (const addr of delSet) delete ruleOwners[addr];
        for (const addr of addSet) ruleOwners[addr] = expected[addr];
        console.log('[设备流量监控] syncRules 删除:', delSet.length, '新增:', addSet.length, 'owner总数:', Object.keys(ruleOwners).length);
        _log('SYNC', `规则同步 del=${delSet.length} add=${addSet.length} owners=${Object.keys(ruleOwners).length}${delSet.length ? ' 删[' + delSet.slice(0, 3).join(',') + (delSet.length > 3 ? '…' : '') + ']' : ''}`); // v20.1.0(G5)
    };

    const flushChain = async () => {
        if (!hasIptables) return;
        const cmd = `${IPT} -t mangle -F ${CHAIN_NAME} 2>/dev/null || true`;
        _logCmd('清空v4链', cmd, await runShellWithRoot(cmd)); // v20.4.0(N5)
    };

    const zeroChainCounters = async () => {
        if (!hasIptables) return;
        const cmd = `${IPT} -t mangle -Z ${CHAIN_NAME} 2>/dev/null || true`;
        _logCmd('清零v4计数', cmd, await runShellWithRoot(cmd)); // v20.4.0(N5)
    };

    // ============================================================
    //  ip6tables - IPv6（B3: 只挂 FORWARD）
    // ============================================================

    const initChain6 = async () => {
        if (!hasIp6tables || !enableIPv6) return;
        await runShellWithRoot(`${IP6T} -t mangle -N ${CHAIN_NAME6} 2>/dev/null || true`);
        await _cleanMounts6();
        await runShellWithRoot(`${IP6T} -t mangle -C FORWARD -j ${CHAIN_NAME6} 2>/dev/null || ${IP6T} -t mangle -I FORWARD 1 -j ${CHAIN_NAME6}`);
    };

    const _cleanMounts6 = async () => {
        if (!hasIp6tables) return;
        // v19.8 曾在 POSTROUTING/INPUT 上按桥接接口(br0)硬编码插入 RETURN 规则，此处仅用于删除这些历史遗留规则
        const legacyIf = 'b' + 'r0';
        const cmds = [
            `${IP6T} -t mangle -D FORWARD -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D POSTROUTING -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D INPUT -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D OUTPUT -j ${CHAIN_NAME6} 2>/dev/null`,
            `${IP6T} -t mangle -D POSTROUTING -o ${legacyIf} -j RETURN 2>/dev/null`,
            `${IP6T} -t mangle -D INPUT -i ${legacyIf} -j RETURN 2>/dev/null`
        ];
        await runShellWithRoot(cmds.join('; ') + '; true');
    };

    const flushChain6 = async () => {
        if (!hasIp6tables) return;
        const cmd = `${IP6T} -t mangle -F ${CHAIN_NAME6} 2>/dev/null || true`;
        _logCmd('清空v6链', cmd, await runShellWithRoot(cmd)); // v20.4.0(N5)
    };

    // v19.10.0: 此处原有 v6 计数清零函数已删除（全文件 0 调用，dead code）

    // ============================================================
    //  单设备限速（v19.10.0）- filter 表 KANO_LIMIT/KANO_LIMIT6 挂 FORWARD 位置1
    //  hashlimit(按字节精确) 优先 → limit(按包pps近似) 回退 → 均不可用则禁用
    // ============================================================

    // 启动探测：建临时链实测一条规则，失败自动降级（用户环境缺部分命令，不硬依赖）
    const detectLimitMode = async () => {
        limitMode = null;
        if (!hasIptables && !hasIp6tables) return;
        const bin = hasIptables ? IPT : IP6T;
        const tmpChain = 'KANO_LTEST';
        try {
            const r = await runShellWithRoot(
                `${bin} -t filter -N ${tmpChain} 2>/dev/null || true; ` +
                `${bin} -t filter -A ${tmpChain} -m hashlimit --hashlimit-above 100kb/s --hashlimit-mode srcip --hashlimit-name kprobe_hash -j DROP 2>/dev/null && echo HASHLIMIT_OK || echo HASHLIMIT_NO; ` +
                `${bin} -t filter -F ${tmpChain} 2>/dev/null; ` +
                `${bin} -t filter -A ${tmpChain} -m limit --limit 10/s --limit-burst 20 -j RETURN 2>/dev/null && echo LIMIT_OK || echo LIMIT_NO; ` +
                `${bin} -t filter -F ${tmpChain} 2>/dev/null; ${bin} -t filter -X ${tmpChain} 2>/dev/null; true`
            );
            const out = _sh(r);
            if (out.includes('HASHLIMIT_OK')) limitMode = 'hashlimit';
            else if (out.includes('LIMIT_OK')) limitMode = 'limit';
        } catch (e) {}
        console.log('[设备流量监控] 限速模块:', limitMode === 'hashlimit' ? 'hashlimit(精确)' : limitMode === 'limit' ? 'limit(近似)' : '不可用');
    };

    // 挂载限速链到 filter FORWARD 位置1（幂等；v6 关闭时顺带清理残留 v6 限速链）
    const mountLimitChains = async () => {
        const cmds = [];
        if (hasIptables) {
            cmds.push(`${IPT} -t filter -N ${LIMIT_CHAIN} 2>/dev/null || true`);
            cmds.push(`${IPT} -t filter -C FORWARD -j ${LIMIT_CHAIN} 2>/dev/null || ${IPT} -t filter -I FORWARD 1 -j ${LIMIT_CHAIN}`);
        }
        if (hasIp6tables) {
            if (enableIPv6) {
                cmds.push(`${IP6T} -t filter -N ${LIMIT_CHAIN6} 2>/dev/null || true`);
                cmds.push(`${IP6T} -t filter -C FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null || ${IP6T} -t filter -I FORWARD 1 -j ${LIMIT_CHAIN6}`);
            } else {
                cmds.push(`${IP6T} -t filter -D FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null`);
                cmds.push(`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`);
                cmds.push(`${IP6T} -t filter -X ${LIMIT_CHAIN6} 2>/dev/null`);
            }
        }
        if (cmds.length) await runShellWithRoot(cmds.join('; ') + '; true');
    };

    // 摘除挂载 + 删链（无限速配置/卸载时调用；链不存在时静默忽略）
    const unmountLimitChains = async () => {
        const cmds = [];
        if (hasIptables) {
            cmds.push(`${IPT} -t filter -D FORWARD -j ${LIMIT_CHAIN} 2>/dev/null`);
            cmds.push(`${IPT} -t filter -F ${LIMIT_CHAIN} 2>/dev/null`);
            cmds.push(`${IPT} -t filter -X ${LIMIT_CHAIN} 2>/dev/null`);
        }
        if (hasIp6tables) {
            cmds.push(`${IP6T} -t filter -D FORWARD -j ${LIMIT_CHAIN6} 2>/dev/null`);
            cmds.push(`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`);
            cmds.push(`${IP6T} -t filter -X ${LIMIT_CHAIN6} 2>/dev/null`);
        }
        if (cmds.length) await runShellWithRoot(cmds.join('; ') + '; true');
    };

    // 每地址独立全额度桶（多地址设备不拆分额度）；limit 回退 pps = max(1, round(KB/s × 1024 / 1500))
    const buildLimitRules = (bin, chain, addr, l, macKey) => {
        const cmds = [];
        const up = Math.max(0, parseInt(l.up) || 0);
        const down = Math.max(0, parseInt(l.down) || 0);
        if (limitMode === 'hashlimit') {
            // v20.1.0(G1): 规则名前缀 kup_/kdown_ 改 ku_/kd_ —— 原名 16/18 字符超 xt_hashlimit name 上限(15)，
            // 部分内核拒绝建规则(探测链名短能过、正式规则名长被据) → 限速完全不生效
            if (up > 0) cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -m hashlimit --hashlimit-above ${up}kb/s --hashlimit-mode srcip --hashlimit-name ku_${macKey} -j DROP`);
            if (down > 0) cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -m hashlimit --hashlimit-above ${down}kb/s --hashlimit-mode dstip --hashlimit-name kd_${macKey} -j DROP`);
        } else if (limitMode === 'limit') {
            if (up > 0) {
                const pps = Math.max(1, Math.round(up * 1024 / 1500));
                cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -m limit --limit ${pps}/s --limit-burst ${2 * pps} -j RETURN`);
                cmds.push(`${bin} -t filter -A ${chain} -s ${addr} -j DROP`);
            }
            if (down > 0) {
                const pps = Math.max(1, Math.round(down * 1024 / 1500));
                cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -m limit --limit ${pps}/s --limit-burst ${2 * pps} -j RETURN`);
                cmds.push(`${bin} -t filter -A ${chain} -d ${addr} -j DROP`);
            }
        }
        return cmds;
    };

    const hasActiveLimits = () => {
        for (const mac of Object.keys(deviceLimits)) {
            const l = deviceLimits[mac] || {};
            if ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0) return true;
        }
        return false;
    };

    // F 清空链规则(保留链与挂载) → 按 deviceLimits × 当前 deviceList 地址(ip + 全部 ip6s) 批量重建(合并 shell 调用)
    // 触发时机：启动 adopt 后、每次 30s 完整同步(syncRules 后)、限速设置变更后
    const applyLimits = async () => {
        if (pluginUninstalled) return;
        if (limitMode === null) return; // 内核不支持限速模块：不建链不挂载
        if (!hasActiveLimits()) {
            // 最后一个限速被清除：摘除挂载 + 删链
            if (limitChainsMounted) {
                await unmountLimitChains();
                limitChainsMounted = false;
                _log('LIMIT', '无限速配置，限速链已摘除'); // v20.1.0(G5)
            }
            return;
        }
        await mountLimitChains();
        limitChainsMounted = true;
        const cmds4 = [`${IPT} -t filter -F ${LIMIT_CHAIN} 2>/dev/null`];
        const cmds6 = [`${IP6T} -t filter -F ${LIMIT_CHAIN6} 2>/dev/null`];
        for (const mac of Object.keys(deviceLimits)) {
            const l = deviceLimits[mac];
            if (!l) continue;
            const dev = deviceList.find(d => d.mac === mac);
            if (!dev) continue; // 设备离线暂无地址，待其上线后由 30s 同步重建
            const macKey = mac.replace(/:/g, '');
            if (dev.ip) cmds4.push(...buildLimitRules(IPT, LIMIT_CHAIN, dev.ip, l, macKey));
            for (const ip6 of (dev.ip6s || [])) {
                cmds6.push(...buildLimitRules(IP6T, LIMIT_CHAIN6, ip6, l, macKey));
            }
        }
        // v20.1.2(H3): 不再静默吞错 —— 捕获写入输出，有报错直接进日志
        if (hasIptables) {
            const r4 = await runShellWithRoot(cmds4.join('; ') + '; true');
            const err4 = _sh(r4).split('\n').filter(l => /invalid|error|denied|not exist|File exists|xtables/i.test(l)).join(' | ');
            if (err4) _log('LIMIT', `⚠ v4限速规则写入报错: ${err4}`);
        }
        if (hasIp6tables && enableIPv6) {
            const r6 = await runShellWithRoot(cmds6.join('; ') + '; true');
            const err6 = _sh(r6).split('\n').filter(l => /invalid|error|denied|not exist|File exists|xtables/i.test(l)).join(' | ');
            if (err6) _log('LIMIT', `⚠ v6限速规则写入报错: ${err6}`);
        }
        // v20.1.0(G1): 回读限速链规则数并写日志 —— 期望 N 条实读 0 条即说明内核拒绝建规则，排查"限速不生效"一目了然
        try {
            const rb = await runShellWithRoot(`${IPT} -t filter -nvxL ${LIMIT_CHAIN} 2>/dev/null || echo ''`);
            const got = ((_sh(rb).match(/DROP|RETURN/g)) || []).length;
            const want = cmds4.length - 1;
            if (want > 0) _log('LIMIT', `限速规则已应用 v4=${got}/${want}条 mode=${limitMode}${got < want ? ' ⚠规则缺失!内核可能拒绝hashlimit规则(规则名/模块限制)' : ''}`);
        } catch (e) {}
    };

    // ============================================================
    //  卸载插件 - 彻底清理所有残留
    // ============================================================

    const uninstallPlugin = async () => {
        if (pluginUninstalled) return;
        // v20.3.0(M1): 弱口令检查已移除，卸载由按钮连点5次确认防呆
        pluginUninstalled = true;

        // 1. 停止自动监控
        if (monitorTimer) { monitorTimer(); monitorTimer = null; }

        // 2. 停止自动归档
        if (autoArchiveTimer) { clearInterval(autoArchiveTimer); autoArchiveTimer = null; }

        // 2.5. v21.0.2(R1): 停止心跳并清理心跳文件
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        try { await _shUser(`rm -f ${HB_PREFIX}* 2>/dev/null || true`); } catch (e) {}

        // 3. 清理 iptables v4 规则（B9: -F 后补 -X 删除链本身）
        await _cleanMounts();
        await flushChain();
        if (hasIptables) await runShellWithRoot(`${IPT} -t mangle -X ${CHAIN_NAME} 2>/dev/null || true`);

        // 4. 清理 iptables v6 规则（含 v19.8 遗留挂载，B9: -F 后补 -X）
        if (hasIp6tables) {
            await _cleanMounts6();
            await flushChain6();
            await runShellWithRoot(`${IP6T} -t mangle -X ${CHAIN_NAME6} 2>/dev/null || true`);
        }

        // 4.5. v19.10.0: 清理限速链 KANO_LIMIT/KANO_LIMIT6（摘挂载 -F -X）
        await unmountLimitChains();

        // 4.6. v21.0.0(P5): 停止统计引擎、摘除开机自启行、删除引擎全部文件
        try { await stopEngine(true); } catch (e) {}
        await _shUser(`rm -f ${ENGINE_BIN} ${ENGINE_BIN}.new ${ENGINE_JSON} ${ENGINE_JSON}.tmp ${ENGINE_VER} ${ENGINE_PID} ${ENGINE_CMD} ${ENGINE_LOG} ${ENGINE_LOG}.tmp /data/data/com.minikano.f50_sms/.kano_engine.b64 /data/data/com.minikano.f50_sms/.kano_deploy.b64`);

        // 5. 删除数据文件（v19.10.0: 含限速配置与 .bak；v20.1.0(G4): 补日志/临时/诊断测试文件，无残留）
        await _shUser(`rm -f ${STORAGE_FILE} ${NAMES_FILE} ${SNAPSHOTS_FILE} ${LIMITS_FILE} ${STORAGE_FILE}.bak ${NAMES_FILE}.bak ${SNAPSHOTS_FILE}.bak ${LIMITS_FILE}.bak ${DEBUG_LOG_FILE} ${DEBUG_LOG_FILE}.tmp /data/data/com.minikano.f50_sms/.diag_test`);

        // 6. 清理 localStorage（本版本未新增持久化 key，沿用 v19.8 清理清单）
        localStorage.removeItem(MONITOR_STATE_KEY);
        localStorage.removeItem('kano_traffic_settings');
        localStorage.removeItem('kano_traffic_ipv6_settings');
        localStorage.removeItem('kano_traffic_ui_mode');
        localStorage.removeItem('kano_last_auto_archive_day');
        localStorage.removeItem('kano_last_auto_archive_month');
        localStorage.removeItem('kano_last_log_clean_day'); // v20.1.0(G4)

        // 7. 移除 DOM
        const iframe = document.querySelector('#IFRAME_KANO_TRAFFIC');
        if (iframe) iframe.remove();

        // 8. 清空内存数据
        selectedSnaps.clear();
        deviceList = [];
        trafficHistory = {};
        customNames = {};
        snapshots = [];
        ruleOwners = {};
        deviceLimits = {};
        historyDirty = false;
        resetClickCount = 0;
        if (resetClickTimer) { clearTimeout(resetClickTimer); resetClickTimer = null; }

        createToast('插件已卸载，所有数据和规则已清除', 'green');
        console.log('[设备流量监控] 插件已卸载');
    };
    // ============================================================
    //  设备发现 - IPv4 (ARP) + IPv6 (NDP) + 本机地址集合
    // ============================================================

    // 本机地址集合：ip -4/-6 addr show 全接口解析（不再硬编码网桥接口）
    // ip 命令缺失时静默降级为空集合
    const refreshLocalAddrs = async () => {
        try {
            const r = await runShellWithRoot(`ip -4 addr show 2>/dev/null || echo ''`);
            const raw = _sh(r) || '';
            const s = new Set();
            for (const m of raw.matchAll(/inet\s+(\d+\.\d+\.\d+\.\d+)/g)) {
                if (m[1] !== '127.0.0.1') s.add(m[1]);
            }
            localAddrs = s;
        } catch (e) { localAddrs = new Set(); }
        try {
            const r = await runShellWithRoot(`ip -6 addr show 2>/dev/null || echo ''`);
            const raw = _sh(r) || '';
            const s = new Set();
            for (const m of raw.matchAll(/inet6\s+([0-9a-fA-F:]+)/g)) {
                const addr = m[1].toLowerCase();
                if (!addr.startsWith('fe80:')) s.add(addr);
            }
            localAddrs6 = s;
        } catch (e) { localAddrs6 = new Set(); }
    };

    const getArpDevs = async () => {
        const r = await runShellWithRoot(`timeout 2s awk '{print}' /proc/net/arp`);
        const devs = [];
        const raw = _sh(r);
        if (!raw) {
            console.log('[设备流量监控] getArpDevs: /proc/net/arp 为空');
            return devs;
        }
        const lines = raw.split('\n');
        for (const line of lines) {
            const p = line.trim().split(/\s+/);
            if (p.length < 6) continue;
            if (p[0] === 'IP' || p[0] === 'IP address') continue;
            const ip = p[0], mac = p[3]?.toLowerCase(), flags = p[2];
            if (!ip.match(/^\d+\.\d+\.\d+\.\d+$/)) continue;
            if (!mac || !mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
            if (mac === '00:00:00:00:00:00') continue;
            if (flags === '0x0') continue;
            if (localAddrs.has(ip)) continue;
            devs.push({ ip, mac });
        }
        return devs;
    };

    const getWifiSignal = async () => {
        const st = {};
        try {
            const r = await runShellWithRoot(`timeout 2s hostapd_cli all_sta 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (raw && raw.includes('=')) {
                const blocks = raw.split(/\n(?=[0-9a-fA-F:]{17})/);
                for (const blk of blocks) {
                    const mac = blk.trim().split('\n')[0]?.trim();
                    if (!mac || !mac.match(/^[0-9a-fA-F:]{17}$/)) continue;
                    const sig = blk.match(/signal=(-?\d+)/);
                    st[mac.toLowerCase()] = sig ? parseInt(sig[1]) : null;
                }
            }
        } catch (e) {}
        if (Object.keys(st).length === 0) {
            // 兜底：iw dev 动态枚举接口，逐个 station dump 合并（不再硬编码接口名）
            try {
                const r = await runShellWithRoot(`timeout 2s iw dev 2>/dev/null || echo ''`);
                const raw = _sh(r);
                const ifs = [];
                for (const m of raw.matchAll(/Interface\s+(\S+)/g)) {
                    if (!ifs.includes(m[1])) ifs.push(m[1]);
                }
                for (const iface of ifs) {
                    try {
                        const r2 = await runShellWithRoot(`timeout 2s iw dev ${iface} station dump 2>/dev/null || echo ''`);
                        const raw2 = _sh(r2);
                        if (!raw2 || !raw2.includes('Station')) continue;
                        const blocks = raw2.split(/\n(?=Station\s+[0-9a-fA-F:]{17})/);
                        for (const blk of blocks) {
                            const mm = blk.match(/Station\s+([0-9a-fA-F:]{17})/);
                            if (!mm) continue;
                            const sig = blk.match(/signal:\s+(-?\d+)\s*dBm/);
                            st[mm[1].toLowerCase()] = sig ? parseInt(sig[1]) : null;
                        }
                    } catch (e2) {}
                }
            } catch (e) {}
        }
        // B7: 已彻底删除 /proc/net/wireless 兜底分支，信号只用 per-station 数据
        return st;
    };

    // B1: NDP 按 MAC 聚合所有全球单播地址（排除 fe80:: 与本机地址集合）
    const getNdDevs = async () => {
        if (!hasIp6tables || !enableIPv6) return [];
        const devs = [];
        try {
            const r = await runShellWithRoot(`ip -6 neigh show 2>/dev/null || echo ''`);
            const raw = _sh(r);
            if (!raw || raw.includes('失败') || raw.includes('No such')) return devs;
            for (const line of raw.split('\n')) {
                const p = line.trim().split(/\s+/);
                if (p.length < 5) continue;
                const ip6 = p[0];
                let mac = null;
                for (let i = 1; i < p.length; i++) {
                    if (p[i] === 'lladdr' && i + 1 < p.length) mac = p[i + 1].toLowerCase();
                }
                if (!ip6 || !mac) continue;
                if (!mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
                if (mac === '00:00:00:00:00:00') continue;
                if (ip6.toLowerCase().startsWith('fe80:')) continue;
                if (localAddrs6.has(ip6.toLowerCase())) continue;
                devs.push({ ip6: ip6.toLowerCase(), mac });
            }
        } catch (e) {}
        return devs;
    };

    const normalizeMac = (mac) => String(mac || '').trim().toLowerCase();
    const defaultDeviceName = (ip) => '设备_' + ((ip || '').split('.').pop() || '??');
    const isDefaultDeviceName = (name) => /^设备_(\d+|\?\?)$/.test(String(name || '').trim());
    const cleanAccessName = (name) => {
        const v = String(name ?? '').trim();
        if (!v) return '';
        const lower = v.toLowerCase();
        if (['unknown', 'null', 'undefined', '--', '-', '*'].includes(lower)) return '';
        if (v === '未知' || v === '未知设备') return '';
        return v;
    };
    const toArray = (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try {
                const parsed = JSON.parse(v);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) { return []; }
        }
        if (v && typeof v === 'object') return Object.values(v).filter(i => i && typeof i === 'object');
        return [];
    };

    const getAccessDeviceInfo = async () => {
        const info = { byMac: {}, byIp: {}, count: 0 };
        try {
            if (typeof getData !== 'function') return info;
            const res = await getData(new URLSearchParams({ cmd: 'station_list,lan_station_list,hostNameList' }));
            const editedNames = {};
            for (const item of toArray(res?.devices)) {
                const mac = normalizeMac(item?.mac || item?.mac_addr || item?.macAddress);
                const hostname = cleanAccessName(item?.hostname || item?.host_name || item?.name);
                if (mac && hostname) editedNames[mac] = hostname;
            }
            const put = (item, connType) => {
                const mac = normalizeMac(item?.mac_addr || item?.mac || item?.macAddress);
                const ip = String(item?.ip_addr || item?.ip || item?.ipaddr || '').trim();
                const hostname = editedNames[mac] || cleanAccessName(item?.hostname || item?.host_name || item?.name);
                if (!hostname) return;
                const dev = { hostname, ip, mac, connType };
                if (mac) info.byMac[mac] = { ...(info.byMac[mac] || {}), ...dev };
                if (ip) info.byIp[ip] = { ...(info.byIp[ip] || {}), ...dev };
                info.count++;
            };
            for (const item of toArray(res?.station_list)) put(item, '无线');
            for (const item of toArray(res?.lan_station_list)) put(item, '有线');
            for (const [mac, hostname] of Object.entries(editedNames)) {
                if (!info.byMac[mac]) info.byMac[mac] = { hostname, ip: '', mac, connType: '' };
            }
        } catch (e) {
            console.warn('[设备流量监控] 读取接入设备名称失败:', e);
        }
        return info;
    };

    // DHCP leases 主机名回退：逐个探测候选文件，首个非空即停；全部不存在时静默返回空表
    const getDhcpLeaseNames = async () => {
        const byMac = {};
        for (const f of LEASES_FILES) {
            try {
                const r = await runShellWithRoot(`timeout 2s awk '{print}' ${f} 2>/dev/null || echo ''`);
                const raw = _sh(r).trim();
                if (!raw) continue;
                // 格式: expiry mac ip hostname clientid
                for (const line of raw.split('\n')) {
                    const p = line.trim().split(/\s+/);
                    if (p.length < 4) continue;
                    const mac = p[1]?.toLowerCase();
                    const hostname = cleanAccessName(p[3]);
                    if (!mac || !mac.match(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
                    if (hostname) byMac[mac] = hostname;
                }
                if (Object.keys(byMac).length > 0) break;
            } catch (e) {}
        }
        return byMac;
    };

    // 命名回退链：自定义名 > getData 接入设备名 > DHCP leases 主机名 > 历史名 > 默认名
    const pickDeviceName = (mac, ip, accessInfo, leaseNames) => {
        const access = accessInfo?.byMac?.[mac] || accessInfo?.byIp?.[ip] || null;
        const leaseName = (leaseNames && leaseNames[mac]) || '';
        const histName = trafficHistory[mac]?.hostname;
        const histValid = histName && !isDefaultDeviceName(histName) ? histName : '';
        const autoName = access?.hostname || leaseName || histValid || defaultDeviceName(ip);
        const nameSource = access?.hostname ? '接入设备' : leaseName ? 'DHCP租约' : histValid ? '历史' : '默认';
        return { name: customNames[mac] || autoName, autoName, access, nameSource };
    };

    const fetchDevs = async () => {
        if (pluginUninstalled) return;
        // v21.0.0(P1): 引擎在线时设备清单来自引擎(netlink 邻居表 v4+v6 按 MAC 聚合)，少打 2 次 shell
        const eng = await readEngineJson();
        if (eng) {
            const [wifiSig, accessInfo, leaseNames] = await Promise.all([
                getWifiSignal(),
                getAccessDeviceInfo(),
                getDhcpLeaseNames()
            ]);
            const m = new Map();
            for (const [mac, ed] of Object.entries(eng.devices || {})) {
                if (!ed || ed.online === false) continue;
                if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
                // 命名回退链(引擎版)：自定义名 > 接入设备名 > 引擎主机名(DHCP租约) > DHCP租约名 > 历史名 > 默认名
                const access = accessInfo?.byMac?.[mac] || (ed.ip ? accessInfo?.byIp?.[ed.ip] : null) || null;
                const engHost = cleanAccessName(ed.hostname);
                const leaseName = leaseNames[mac] || '';
                const histName = trafficHistory[mac]?.hostname;
                const histValid = histName && !isDefaultDeviceName(histName) ? histName : '';
                const autoName = access?.hostname || engHost || leaseName || histValid || defaultDeviceName(ed.ip || '');
                m.set(mac, {
                    ip: ed.ip || null,
                    ip6s: Array.isArray(ed.ip6s) ? ed.ip6s : [],
                    mac,
                    hostname: customNames[mac] || autoName,
                    autoName,
                    nameSource: access?.hostname ? '接入设备' : engHost ? '引擎' : leaseName ? 'DHCP租约' : histValid ? '历史' : '默认',
                    signal: wifiSig[mac] ?? null,
                    connType: access?.connType || ed.connType || ''
                });
            }
            const engList = Array.from(m.values());
            // 与 M7 同一思路: 引擎 JSON 瞬态空读(重启写盘间隙)沿用上一轮列表
            if (engList.length === 0 && deviceList.length > 0) {
                _log('SYNC', `fetchDevs(引擎)瞬态空读 沿用上轮${deviceList.length}台`);
                return;
            }
            deviceList = engList;
            return;
        }
        await refreshLocalAddrs();
        const [arpDevs, ndDevs, wifiSig, accessInfo, leaseNames] = await Promise.all([
            getArpDevs(),
            getNdDevs(),
            getWifiSignal(),
            getAccessDeviceInfo(),
            getDhcpLeaseNames()
        ]);
        console.log('[设备流量监控] ARP:', arpDevs.length, 'NDP:', ndDevs.length, '接入设备:', accessInfo.count, 'DHCP租约:', Object.keys(leaseNames).length);

        const m = new Map();
        for (const d of arpDevs) {
            const picked = pickDeviceName(d.mac, d.ip, accessInfo, leaseNames);
            m.set(d.mac, {
                ip: d.ip, ip6s: [], mac: d.mac,
                hostname: picked.name, autoName: picked.autoName, nameSource: picked.nameSource,
                signal: wifiSig[d.mac] ?? null,
                connType: picked.access?.connType || ''
            });
        }
        // B1: 同一 MAC 的所有全球单播 IPv6 地址聚合到 ip6s 数组
        for (const d of ndDevs) {
            const existing = m.get(d.mac);
            if (existing) {
                if (!existing.ip6s.includes(d.ip6)) existing.ip6s.push(d.ip6);
            } else {
                const picked = pickDeviceName(d.mac, '', accessInfo, leaseNames);
                m.set(d.mac, {
                    ip: null, ip6s: [d.ip6], mac: d.mac,
                    hostname: picked.name, autoName: picked.autoName, nameSource: picked.nameSource,
                    signal: wifiSig[d.mac] ?? null,
                    connType: picked.access?.connType || ''
                });
            }
        }
        const nextList = Array.from(m.values());
        // v20.3.0(M7): 瞬态空读保护 —— ARP+NDP 全空但上一轮明明有设备，大概率是 shell 抖动；
        // 直接采用会让 syncRules 把全部规则删掉下轮又重建(计数清零+规则churn)。保留上轮列表，下轮再确认
        if (nextList.length === 0 && deviceList.length > 0) {
            console.log('[设备流量监控] fetchDevs: 本轮结果为空，疑瞬态抖动，沿用上一轮设备列表');
            _log('SYNC', `fetchDevs瞬态空读 沿用上轮${deviceList.length}台`);
            return;
        }
        deviceList = nextList;
    };
    // ============================================================
    //  流量统计 - IPv4 + IPv6（B1: 对全部 ip6s 求和）
    // ============================================================

    // v19.10.0: getCounters/getCounters6 合并为 getCounters(v6)（解析逻辑逐字保留；参数化 bin/chain/anyTok/minCols）
    const getCounters = async (v6) => {
        if (v6 ? (!hasIp6tables || !enableIPv6) : !hasIptables) return {};
        const bin = v6 ? IP6T : IPT;
        const chain = v6 ? CHAIN_NAME6 : CHAIN_NAME;
        const anyTok = v6 ? '::/0' : '0.0.0.0/0';
        const minCols = 9; // -nvxL 输出 pkts/bytes/target/prot/opt/in/out/source/destination 同为 9 列（v4/v6 一致）
        const r = await runShellWithRoot(`${bin} -t mangle -nvxL ${chain} 2>/dev/null`); // v20.3.0(M8): 屏蔽stderr，链不存在/shell失败时 stdout 必为空 → 可靠识别为读取失败
        const c = {};
        const raw = _sh(r);
        // v20.3.0(M8): 读取失败返回 null(区别于"链存在但无规则"的 {}) —— 调用方据此跳过本轮统计，
        // 避免把瞬态 shell 失败的空读误判为"全部地址出局"而重复补计
        if (!raw) {
            console.log(`[设备流量监控] getCounters(${v6 ? 'v6' : 'v4'}): 读取失败，本轮跳过`);
            return null;
        }
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Chain') && !l.startsWith('pkts') && l.includes('RETURN'));
        for (const line of lines) {
            const p = line.split(/\s+/);
            if (p.length < minCols) continue;
            const bytes = parseInt(p[1]) || 0;
            // 从后往前取：最后两列永远是 source 和 destination
            const src = p[p.length - 2], dst = p[p.length - 1];
            if (src && src !== anyTok && dst === anyTok) { if (!c[src]) c[src] = { up: 0, down: 0 }; c[src].up = bytes; }
            else if (dst && dst !== anyTok && src === anyTok) { if (!c[dst]) c[dst] = { up: 0, down: 0 }; c[dst].down = bytes; }
        }
        return c;
    };

    let lastUpdateTime = Date.now();

    const updateStats = async () => {
        if (pluginUninstalled) return;
        // v21.0.0(P1/P2): 引擎在线走引擎数据(conntrack 内核精确记账)，掉线自动回退 iptables 路径
        const eng = await readEngineJson();
        if (eng) { await updateStatsFromEngine(eng); return; }
        const [counters, counters6] = await Promise.all([getCounters(false), getCounters(true)]);
        // v20.3.0(M8): 任一族读取失败(null) → 本轮整体跳过、台账原样保留；
        // 若照常跑，"地址出局补计"会把台账值并入 totalUp，而链上计数器其实还在 → 下轮 curUp 再算一遍 = 重复计数
        if (counters === null || counters6 === null) return;
        const now = Date.now();
        const elapsedSec = Math.max((now - lastUpdateTime) / 1000, 0.1);
        lastUpdateTime = now;
        for (const d of deviceList) {
            // v20.0.2(F9): 按地址独立台账(addrUp/addrDown) —— 旧逻辑"总和下降即全额累加 lastUp"，
            // 多IPv6设备临时地址轮换出局时总和必降 → 仍在计数地址的流量被反复重复累加 → 总量虚高(123GB异常根因)
            const cur = {}; // addr -> {up, down}
            if (d.ip && counters[d.ip]) cur[d.ip] = counters[d.ip];
            for (const ip6 of (d.ip6s || [])) {
                if (counters6[ip6]) cur[ip6] = counters6[ip6];
            }

            const h = trafficHistory[d.mac] || { totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0, firstSeen: now, speedUp: 0, speedDown: 0, ip: d.ip, ip6s: [], addrUp: {}, addrDown: {} };
            h.addrUp = h.addrUp || {}; h.addrDown = h.addrDown || {}; // 旧数据迁移：首轮重新建立基线

            let upBytes = 0, downBytes = 0;
            for (const [addr, c] of Object.entries(cur)) {
                const lu = h.addrUp[addr] || 0, ld = h.addrDown[addr] || 0;
                // 仅"该地址自身"计数器变小(规则被重建/清零)时，才补这一个地址丢失的值
                if ((c.up || 0) < lu) { h.totalUp += lu; if (lu > 10 * 1024 * 1024) _log('STATS', `计数重置保留 mac=${d.mac} addr=${addr} up=${(lu/1048576).toFixed(1)}MB→新${((c.up||0)/1048576).toFixed(1)}MB`); }
                if ((c.down || 0) < ld) { h.totalDown += ld; if (ld > 10 * 1024 * 1024) _log('STATS', `计数重置保留 mac=${d.mac} addr=${addr} down=${(ld/1048576).toFixed(1)}MB→新${((c.down||0)/1048576).toFixed(1)}MB`); }
                upBytes += c.up || 0; downBytes += c.down || 0;
                h.addrUp[addr] = c.up || 0; h.addrDown[addr] = c.down || 0;
            }
            // 本轮出局的地址(IPv6临时地址轮换/换IP)：计数器随规则删除消失，最后读数只补一次后移出台账
            for (const addr of Object.keys(h.addrUp)) {
                if (!(addr in cur)) {
                    const lost = h.addrUp[addr];
                    h.totalUp += lost;
                    if (lost > 10 * 1024 * 1024) _log('STATS', `地址出局保留计数 mac=${d.mac} addr=${addr} up=${(lost/1048576).toFixed(1)}MB`);
                    delete h.addrUp[addr];
                }
            }
            for (const addr of Object.keys(h.addrDown)) {
                if (!(addr in cur)) {
                    const lost = h.addrDown[addr];
                    h.totalDown += lost;
                    if (lost > 10 * 1024 * 1024) _log('STATS', `地址出局保留计数 mac=${d.mac} addr=${addr} down=${(lost/1048576).toFixed(1)}MB`);
                    delete h.addrDown[addr];
                }
            }
            h.speedUp = Math.max(0, Math.round((upBytes - h.curUp) / elapsedSec));
            h.speedDown = Math.max(0, Math.round((downBytes - h.curDown) / elapsedSec));
            h.curUp = upBytes; h.curDown = downBytes;
            h.lastUp = upBytes; h.lastDown = downBytes;
            h.lastSeen = now; h.hostname = d.hostname; h.ip = d.ip;
            h.ip6s = d.ip6s || [];
            h.ip6 = h.ip6s[0] || null; // 兼容旧字段
            trafficHistory[d.mac] = h;
        }
        // B8: 写盘节流 —— 仅置脏标记，>=30s 落盘一次
        historyDirty = true;
        scanAbnormalTraffic(); // v21.0.0: 抽出共用(引擎/iptables 两路径同一口径)
        if (now - lastHistorySave >= HISTORY_SAVE_INTERVAL) await flushHistory(true);
    };

    // v21.0.0: 异常流量扫描(原 updateStats 尾部逻辑抽出, 引擎/iptables 两路径共用)
    // v20.1.6(K1): 按 mac+量级(每10GB一档) 只记一次 —— 原逻辑每个监控tick(5s)刷一条，200条日志上限被同一WARN冲爆
    const scanAbnormalTraffic = () => {
        for (const d of deviceList) {
            const h = trafficHistory[d.mac];
            if (!h) continue;
            const total = h.totalUp + h.totalDown + h.curUp + h.curDown;
            if (total > 10 * 1024 * 1024 * 1024 && h.totalUp > h.curUp * 2) {
                const warnKey = d.mac + '@' + Math.floor(total / (10 * 1024 * 1024 * 1024));
                if (_warnedAbnormal[warnKey]) continue;
                _warnedAbnormal[warnKey] = true;
                _log("WARN", `异常流量 mac=${d.mac} total=${(total/1e9).toFixed(1)}GB totalUp=${((h.totalUp||0)/1e9).toFixed(1)}GB curUp=${((h.curUp||0)/1e9).toFixed(2)}GB 地址数=${Object.keys(h.addrUp||{}).length} 疑似重复累加`);
            }
        }
    };

    // v21.0.0(P1/P3): 引擎模式统计 —— 引擎计数为"自引擎启动以来累计"且不可被插件清零,
    // 故以 engBase*(重计基线)差值作为当前段: curUp = 引擎累计 - 基线;
    // 引擎重启/计数回退(累计 < 基线)时先把旧段差额并入 totalUp 再归零基线 —— 与 F9 "计数重置保留"同思路
    const updateStatsFromEngine = async (eng) => {
        const now = Date.now();
        lastUpdateTime = now;
        for (const d of deviceList) {
            const ed = eng.devices ? eng.devices[d.mac] : null;
            const h = trafficHistory[d.mac] || { totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0, firstSeen: now, speedUp: 0, speedDown: 0, ip: d.ip, ip6s: [], addrUp: {}, addrDown: {} };
            const eup = ed ? (ed.txBytes || 0) : (h.engLastUp || 0);   // 设备暂时不在引擎 JSON 时沿用最后读数
            const edown = ed ? (ed.rxBytes || 0) : (h.engLastDown || 0);
            if (typeof h.engBaseUp !== 'number') { h.engBaseUp = eup; h.engBaseDown = edown; } // 旧数据迁移: 从当前累计起计
            if (eup < h.engBaseUp || edown < h.engBaseDown) {
                const lostUp = Math.max(0, (h.engLastUp || 0) - h.engBaseUp);
                const lostDown = Math.max(0, (h.engLastDown || 0) - h.engBaseDown);
                h.totalUp += lostUp; h.totalDown += lostDown;
                if (lostUp + lostDown > 10 * 1024 * 1024) _log('STATS', `引擎计数重置保留 mac=${d.mac} 保留=${formatBytes(lostUp + lostDown)}`);
                h.engBaseUp = 0; h.engBaseDown = 0;
            }
            h.curUp = Math.max(0, eup - h.engBaseUp);
            h.curDown = Math.max(0, edown - h.engBaseDown);
            h.engLastUp = eup; h.engLastDown = edown;
            h.speedUp = ed ? (ed.txRateBps || 0) : 0;   // 速率由引擎按真实周期间隔计算, 不受页面挂起影响
            h.speedDown = ed ? (ed.rxRateBps || 0) : 0;
            h.lastUp = h.curUp; h.lastDown = h.curDown;
            h.lastSeen = now; h.hostname = d.hostname; h.ip = d.ip;
            h.ip6s = d.ip6s || [];
            h.ip6 = h.ip6s[0] || null;
            trafficHistory[d.mac] = h;
        }
        historyDirty = true;
        scanAbnormalTraffic();
        if (now - lastHistorySave >= HISTORY_SAVE_INTERVAL) await flushHistory(true);
    };

    const getTraffic = (mac) => {
        const h = trafficHistory[mac];
        if (!h) return { up: 0, down: 0, total: 0, speedUp: 0, speedDown: 0 };
        return {
            up: h.totalUp + h.curUp,
            down: h.totalDown + h.curDown,
            total: h.totalUp + h.totalDown + h.curUp + h.curDown,
            speedUp: h.speedUp || 0,
            speedDown: h.speedDown || 0
        };
    };

    // v19.10.0: 提取 history 重建块（clearAllTraffic / archiveAndReset 共用，行为逐字段保持一致，含 ip6s/ip6 兼容字段）
    // keepLastSeen=true 保留原 lastSeen（清除全部流量）；false 则刷新为 now（归档并重计）
    const resetHistoryEntries = (now, keepLastSeen) => {
        _warnedAbnormal = {}; // v20.1.6(K1): 计数已清零，允许异常流量 WARN 重新记录
        // v21.0.0(P3): 引擎计数不可被插件清零 —— 引擎模式下重计基线=引擎当前累计，
        // 之后当前段=引擎累计-基线，天然从 0 起计且无竞态(无需等引擎执行清零)
        const eng = _engineJsonCache.data;
        for (const mac of Object.keys(trafficHistory)) {
            const prev = trafficHistory[mac];
            const ed = eng && eng.devices ? eng.devices[mac] : null;
            const baseUp = ed ? (ed.txBytes || 0) : (prev.engLastUp || 0);
            const baseDown = ed ? (ed.rxBytes || 0) : (prev.engLastDown || 0);
            trafficHistory[mac] = {
                totalUp: 0, totalDown: 0, curUp: 0, curDown: 0,
                lastUp: 0, lastDown: 0,
                firstSeen: prev.firstSeen || now,
                lastSeen: keepLastSeen ? (prev.lastSeen || now) : now,
                hostname: prev.hostname,
                ip: prev.ip,
                ip6s: prev.ip6s || (prev.ip6 ? [prev.ip6] : []),
                ip6: prev.ip6,
                engBaseUp: baseUp, engBaseDown: baseDown,
                engLastUp: baseUp, engLastDown: baseDown
            };
        }
    };
    // ============================================================
    //  UI
    // ============================================================

    const fmtSig = (dbm) => {
        if (dbm === null || dbm === undefined) return '<span style="opacity:.4">--</span>';
        const c = dbm >= -60 ? '#4ade80' : dbm >= -70 ? '#facc15' : dbm >= -80 ? '#fb923c' : '#f87171';
        const lv = dbm >= -50 ? '极强' : dbm >= -60 ? '强' : dbm >= -70 ? '中' : dbm >= -80 ? '弱' : '极弱';
        return `<span style="color:${c}">${lv}</span>`;
    };

    const fmtTime = (ts) => {
        if (!ts) return '--';
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    };

    // B1: IPv6 角标 —— 第一个地址 + +v6(N)（N>1 时显示数量）
    const fmtIp6Badge = (ip6s) => {
        if (!ip6s || ip6s.length === 0) return '';
        const label = ip6s.length > 1 ? `+v6(${ip6s.length})` : '+v6';
        return `<span style="font-size:9px;opacity:.5;margin-left:4px;">${label}</span>`;
    };

    // v19.10.0: ⏱ 限速按钮 —— 样式照抄 rename 按钮；该设备有限速时背景高亮 var(--dark-btn-color-active)
    const fmtLimitBtn = (mac, offline) => {
        const l = deviceLimits[mac] || {};
        const limited = (parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0;
        const base = offline
            ? 'font-size:9px;padding:1px 4px;border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:inherit;cursor:pointer;'
            : 'font-size:10px;padding:1px 5px;border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:inherit;cursor:pointer;';
        const bg = limited ? 'background:var(--dark-btn-color-active);' : (offline ? 'background:rgba(255,255,255,0.05);' : 'background:rgba(255,255,255,0.08);');
        const op = limited ? '.95' : (offline ? '.4' : '.5');
        return `<button class="kano-limit-btn" data-mac="${mac}" title="限速" style="${base}${bg}opacity:${op};">&#x23F1;&#xFE0F;</button>`;
    };

    const renderList = () => {
        if (pluginUninstalled) return;
        const tbody = document.querySelector('#kano_traffic_tbody');
        if (!tbody) return;

        let grand = 0;
        for (const d of deviceList) grand += getTraffic(d.mac).total;
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (!deviceList.find(d => d.mac === mac)) grand += getTraffic(mac).total;
        }

        const sortedDevices = [...deviceList].sort((a, b) => getTraffic(b.mac).total - getTraffic(a.mac).total);

        let html = '';

        if (sortedDevices.length > 0) {
            html += `<tr><td colspan="7" style="padding:6px 8px;font-size:10px;opacity:.5;text-align:left;color:#4ade80;">&#x1F4F6; 在线设备 (${sortedDevices.length})</td></tr>`;
            for (const d of sortedDevices) {
                const t = getTraffic(d.mac);
                const pct = grand > 0 ? ((t.total / grand) * 100).toFixed(1) : 0;
                const ip6s = d.ip6s || [];
                let ipDisplay = d.ip || '--';
                ipDisplay += fmtIp6Badge(ip6s);
                html += `<tr class="kano-tr" style="border-bottom:1px solid rgba(255,255,255,0.04);" data-mac="${d.mac}">
                    <td class="kano-td" style="padding:10px 8px;">
                        <div class="kano-hostname" style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;">
                            ${escHtml(d.hostname)}
                            ${d.connType ? `<span style="font-size:9px;opacity:.5;font-weight:400;" title="连接方式(来自接入设备列表)">${d.connType === '有线' ? '&#x1F50C;有线' : d.connType === '无线' ? '&#x1F4E1;无线' : escHtml(d.connType)}</span>` : ''}
                            <button class="kano-rename-btn" data-mac="${d.mac}" title="改名" style="font-size:10px;padding:1px 5px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:inherit;cursor:pointer;opacity:.5;">&#x270F;&#xFE0F;</button>
                        </div>
                        <div style="font-size:11px;opacity:.55;">${ipDisplay}</div>
                        ${ip6s.length ? `<div style="font-size:9px;opacity:.35;word-break:break-all;">${escHtml(ip6s[0])}${ip6s.length > 1 ? ` 等${ip6s.length}个` : ''}</div>` : ''}
                    </td>
                    <td class="kano-td kano-mac" style="padding:10px 8px;font-size:11px;font-family:monospace;opacity:.65;">${d.mac}</td>
                    <td class="kano-td kano-signal" style="padding:10px 8px;text-align:center;font-size:12px;">${fmtSig(d.signal)}${d.signal !== null ? `<div style="font-size:10px;opacity:.5">${d.signal}dBm</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-family:monospace;font-size:12px;color:#4ade80;">${formatBytes(t.up)}${t.speedUp > 0 ? `<div style="font-size:9px;opacity:.6;color:#fbbf24;">+${formatBytes(t.speedUp)}/s</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-family:monospace;font-size:12px;color:#60a5fa;">${formatBytes(t.down)}${t.speedDown > 0 ? `<div style="font-size:9px;opacity:.6;color:#fbbf24;">+${formatBytes(t.speedDown)}/s</div>` : ''}</td>
                    <td class="kano-td" style="padding:10px 8px;text-align:right;font-size:12px;min-width:90px;">
                        <div style="font-weight:700;color:var(--dark-btn-color-active);">${formatBytes(t.total)}</div>
                        <div style="width:100%;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--dark-btn-color-active),#4ade80);border-radius:2px;"></div></div>
                        <div style="font-size:9px;opacity:.4;text-align:right;">${pct}%</div>
                    </td>
                    <td class="kano-td" style="padding:10px 4px;text-align:center;">
                        ${fmtLimitBtn(d.mac, false)}
                        <button class="kano-del-btn" data-mac="${d.mac}" data-ip="${d.ip || ''}" data-ip6="${ip6s[0] || ''}" title="删除" style="font-size:12px;padding:2px 6px;background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.2);border-radius:4px;color:#ff6b6b;cursor:pointer;opacity:.7;">&#x1F5D1;</button>
                    </td>
                </tr>`;
            }
        }

        const onlineMacs = new Set(sortedDevices.map(d => d.mac));
        const offlineDevs = [];
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (onlineMacs.has(mac)) continue;
            const t = getTraffic(mac);
            if (t.total === 0) continue;
            offlineDevs.push({
                mac,
                hostname: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
                ip: h.ip || '--',
                ip6s: h.ip6s || (h.ip6 ? [h.ip6] : []),
                lastSeen: h.lastSeen,
                total: t.total
            });
        }
        offlineDevs.sort((a, b) => b.total - a.total);

        if (offlineDevs.length > 0) {
            html += `<tr><td colspan="7" style="padding:6px 8px;font-size:10px;opacity:.5;text-align:left;color:#888;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">&#x1F4F4; 离线设备 (${offlineDevs.length}) &mdash; 曾经连接过</td></tr>`;
            for (const d of offlineDevs) {
                const t = getTraffic(d.mac);
                const pct = grand > 0 ? ((t.total / grand) * 100).toFixed(1) : 0;
                let ipDisplay = d.ip || '--';
                ipDisplay += fmtIp6Badge(d.ip6s);
                html += `<tr class="kano-tr" style="border-bottom:1px solid rgba(255,255,255,0.02);opacity:.55;" data-mac="${d.mac}">
                    <td class="kano-td" style="padding:8px;">
                        <div class="kano-hostname" style="font-weight:600;font-size:12px;display:flex;align-items:center;gap:6px;">
                            ${escHtml(d.hostname)}
                            <button class="kano-rename-btn" data-mac="${d.mac}" title="改名" style="font-size:9px;padding:1px 4px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:inherit;cursor:pointer;opacity:.4;">&#x270F;&#xFE0F;</button>
                        </div>
                        <div style="font-size:10px;opacity:.4;">${ipDisplay}</div>
                        ${d.ip6s.length ? `<div style="font-size:9px;opacity:.3;word-break:break-all;">${escHtml(d.ip6s[0])}${d.ip6s.length > 1 ? ` 等${d.ip6s.length}个` : ''}</div>` : ''}
                    </td>
                    <td class="kano-td kano-mac" style="padding:8px;font-size:10px;font-family:monospace;opacity:.5;">${d.mac}</td>
                    <td class="kano-td kano-signal" style="padding:8px;text-align:center;font-size:11px;opacity:.4;">--</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-family:monospace;font-size:11px;color:#4ade80;opacity:.5;">${formatBytes(t.up)}</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-family:monospace;font-size:11px;color:#60a5fa;opacity:.5;">${formatBytes(t.down)}</td>
                    <td class="kano-td" style="padding:8px;text-align:right;font-size:11px;min-width:90px;">
                        <div style="font-weight:600;">${formatBytes(t.total)}</div>
                        <div style="font-size:9px;opacity:.35;">${fmtTime(d.lastSeen)}</div>
                    </td>
                    <td class="kano-td" style="padding:8px 4px;text-align:center;">
                        ${fmtLimitBtn(d.mac, true)}
                        <button class="kano-del-btn" data-mac="${d.mac}" data-ip="${d.ip === '--' ? '' : d.ip}" data-ip6="${d.ip6s[0] || ''}" title="删除" style="font-size:11px;padding:2px 5px;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.15);border-radius:4px;color:#ff6b6b;cursor:pointer;opacity:.5;">&#x1F5D1;</button>
                    </td>
                </tr>`;
            }
        }

        if (deviceList.length === 0 && offlineDevs.length === 0) {
            html = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">暂无设备</td></tr>`;
        }

        tbody.innerHTML = html;
        tbody.querySelectorAll('.kano-rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showRenameModal(btn.dataset.mac); });
        });
        tbody.querySelectorAll('.kano-limit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showLimitModal(btn.dataset.mac); });
        });
        tbody.querySelectorAll('.kano-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); showDeleteConfirm(btn.dataset.mac, btn.dataset.ip, btn.dataset.ip6); });
        });
    };

    const renderOverview = () => {
        if (pluginUninstalled) return;
        const el = document.querySelector('#kano_traffic_overview');
        if (!el) return;
        let up = 0, down = 0;
        for (const d of deviceList) { const t = getTraffic(d.mac); up += t.up; down += t.down; }
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;text-align:center;"><!-- v20.2.0(L5): 自适应列数，窄容器不再挤压 -->
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">接入设备</div><div style="font-size:22px;font-weight:900;color:var(--dark-btn-color-active);">${deviceList.length}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总上行</div><div style="font-size:14px;font-weight:800">${formatBytes(up)}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总下行</div><div style="font-size:14px;font-weight:800">${formatBytes(down)}</div></div>
            <div style="padding:12px 4px;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:10px;opacity:.55">总流量</div><div style="font-size:14px;font-weight:800;color:#a78bfa">${formatBytes(up+down)}</div></div>
        </div>`;
    };
    // ============================================================
    //  弹窗: 改名（B6: 离线设备可改名，回退 trafficHistory）
    // ============================================================

    const showRenameModal = (mac) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const h = trafficHistory[mac];
        if (!dev && !h) return;
        // deviceList 查不到时回退用 trafficHistory 构造上下文（ip/ip6s 取历史值）
        const hIp6s = h ? (h.ip6s || (h.ip6 ? [h.ip6] : [])) : [];
        const ctx = dev || {
            mac,
            ip: h.ip || '',
            ip6s: hIp6s,
            hostname: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
            autoName: (h.hostname && !isDefaultDeviceName(h.hostname) ? h.hostname : '') || defaultDeviceName(h.ip)
        };
        const currentName = customNames[mac] || ctx.hostname;
        const ip6s = ctx.ip6s || [];
        const { id, el } = createModal({
            name: 'traffic_rename_modal', title: '修改设备名称', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '保存', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                const input = el.querySelector('#rename_input');
                const val = input?.value?.trim();
                if (val) {
                    customNames[mac] = val;
                    await saveNames();
                    const d = deviceList.find(x => x.mac === mac);
                    if (d) d.hostname = val;
                    if (trafficHistory[mac]) { trafficHistory[mac].hostname = val; await flushHistory(true); }
                    renderList();
                    createToast('已保存到设备: ' + val, 'green');
                } else {
                    delete customNames[mac];
                    await saveNames();
                    const d = deviceList.find(x => x.mac === mac);
                    if (d) d.hostname = d.autoName || defaultDeviceName(d.ip);
                    if (trafficHistory[mac]) {
                        trafficHistory[mac].hostname = d ? d.hostname : (ctx.autoName || defaultDeviceName(ctx.ip));
                        await flushHistory(true);
                    }
                    renderList();
                    createToast('已恢复默认', 'green');
                }
                return true;
            },
            content: `<div style="font-size:13px;margin-bottom:10px;opacity:.7;">MAC: <span style="font-family:monospace;">${mac}</span><br>IP: ${ctx.ip || '--'}${ip6s.length ? '<br>IPv6: ' + escHtml(ip6s[0]) + (ip6s.length > 1 ? ` 等${ip6s.length}个` : '') : ''}</div><input id="rename_input" type="text" value="${escHtml(currentName)}" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;" placeholder="输入名称，留空恢复默认"><div style="margin-top:8px;font-size:11px;opacity:.5;">留空将恢复为自动识别名称：${escHtml(ctx.autoName || defaultDeviceName(ctx.ip))}</div>`
        });
        showModal(id);
        setTimeout(() => { const input = el.querySelector('#rename_input'); if (input) { input.focus(); input.select(); } }, 100);
    };

    // ============================================================
    //  弹窗: 单设备限速（v19.10.0，0 或留空 = 不限；两框均为 0/空 = 删除限速）
    // ============================================================

    // ============================================================
    //  v20.1.2(H3): 限速专项诊断 —— 不再静默吞错，直接给出"为什么限速没用"
    //  采集: ①内核hashlimit注册 ②实测建规则真实报错 ③链上规则+命中包数
    //        ④hashlimit运行表 ⑤硬件转发加速模块 ⑥FORWARD挂载点命中
    // ============================================================

    const runLimitDiag = async () => {
        const out = [];
        const sec = (t) => out.push('', '=== ' + t + ' ===');
        if (!hasIptables) return 'iptables 不可用，无法进行限速诊断';
        sec('基本信息');
        out.push(`限速模式: ${limitMode === 'hashlimit' ? 'hashlimit(精确)' : limitMode === 'limit' ? 'limit(近似)' : '不可用'}`);
        out.push(`限速链已挂载: ${limitChainsMounted ? '是' : '否'}`);
        const activeN = Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length;
        out.push(`限速配置: ${activeN}台设备 ${JSON.stringify(deviceLimits)}`);

        sec('① 内核 hashlimit 支持');
        try {
            const m1 = _sh(await runShellWithRoot(`lsmod 2>/dev/null | grep -i hashlimit || echo NOLMOD`));
            out.push('lsmod: ' + (m1.includes('NOLMOD') ? '未见独立模块（可能已内置内核，以②实测为准）' : m1.trim()));
            const m2 = _sh(await runShellWithRoot(`timeout 2s awk '{print}' /proc/net/ip_tables_matches 2>/dev/null || echo ''`));
            out.push('matches 注册表含 hashlimit: ' + (m2.split('\n').some(l => l.trim() === 'hashlimit') ? '是 ✓' : '否 ✗（→ 内核不支持，限速必然无效）'));
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('② 实测建规则（真实错误输出，不静默）');
        const TC = 'KANO_LDIAG';
        try {
            const t = _sh(await runShellWithRoot(
                `${IPT} -t filter -N ${TC} 2>/dev/null || true; ` +
                `${IPT} -t filter -A ${TC} -s 192.0.2.1 -m hashlimit --hashlimit-above 100kb/s --hashlimit-mode srcip --hashlimit-name ku_diag1 -j DROP 2>&1; echo "hashlimit规则 exit=$?"; ` +
                `${IPT} -t filter -A ${TC} -s 192.0.2.2 -m limit --limit 10/s -j DROP 2>&1; echo "limit规则 exit=$?"; ` +
                `${IPT} -t filter -F ${TC} 2>/dev/null; ${IPT} -t filter -X ${TC} 2>/dev/null; true`
            ));
            out.push(t.trim() || '(无输出)');
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        // v20.1.3(I1): 被限速设备地址清单 —— v4 规则 pkts=0 时，先看设备是不是带着 IPv6 地址在跑 v6 流量
        sec('③ 被限速设备地址清单');
        try {
            const rows = [];
            for (const mac of Object.keys(deviceLimits)) {
                const l = deviceLimits[mac];
                if (!l || !((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)) continue;
                const dev = deviceList.find(d => d.mac === mac);
                const v6s = dev?.ip6s || [];
                rows.push(`${mac}  限速${l.up || 0}KB/s↑ ${l.down || 0}KB/s↓\n  IPv4: ${dev?.ip || '(离线)'}\n  IPv6: ${v6s.length ? v6s.join(', ') : '(无)'}`);
            }
            out.push(rows.length ? rows.join('\n') : '(当前无生效的限速配置)');
            if (!enableIPv6) out.push('⚠ 插件IPv6统计未启用 → 不建任何v6限速规则，设备走IPv6的流量完全不受限！(设置里开启IPv6后重设限速)');
        } catch (e) { out.push('采集异常: ' + (e?.message || e)); }

        // v20.1.3(I1): 10秒双采样 —— 规则每30s重建导致计数器年轻，单快照 pkts=0 不能定论；T0/T1 增量直接回答"包过没过这条链"
        // 采集期间请让被限速设备持续跑流量（测速/看视频），否则增量为 0 无法说明问题
        sec('③a KANO_LIMIT(v4) 10秒双采样（采样期间请让设备跑流量）');
        let v4delta = null;
        try {
            const sumPkts = (txt) => (txt.match(/^\s*(\d+)\s+\d+\s+(DROP|RETURN)/gm) || [])
                .reduce((s, l) => s + (parseInt(l.trim().split(/\s+/)[0]) || 0), 0);
            const sample = `${IPT} -t filter -nvxL ${LIMIT_CHAIN} 2>/dev/null || echo NOCHAIN`;
            const twoPhase = _sh(await runShellWithRoot(
                `echo ===T0===; ${sample}; echo ===SLEEP===; sleep 10; echo ===T1===; ${sample}`, 30000));
            const t0 = (twoPhase.split('===SLEEP===')[0] || '').replace('===T0===', '');
            const t1 = (twoPhase.split('===T1===')[1] || '');
            if (twoPhase.includes('NOCHAIN')) {
                out.push('链不存在 → 限速规则未应用（先给设备设置一个限速再来诊断）');
            } else {
                v4delta = sumPkts(t1) - sumPkts(t0);
                out.push(`10秒内 命中包数增量: ${v4delta} 个${v4delta > 0 ? ' ✓ 有包经过限速链' : ' ⚠ 没有任何包命中限速规则'}`);
                out.push('--- T1 链实况 ---');
                out.push(t1.trim() || '(无输出)');
            }
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('③b KANO_LIMIT6(v6) 10秒双采样');
        try {
            if (!hasIp6tables) {
                out.push('ip6tables 不可用，跳过');
            } else if (!enableIPv6) {
                out.push('插件IPv6未启用 → v6不限速（见③警告）');
            } else {
                const sumPkts6 = (txt) => (txt.match(/^\s*(\d+)\s+\d+\s+(DROP|RETURN)/gm) || [])
                    .reduce((s, l) => s + (parseInt(l.trim().split(/\s+/)[0]) || 0), 0);
                const sample6 = `${IP6T} -t filter -nvxL ${LIMIT_CHAIN6} 2>/dev/null || echo NOCHAIN6`;
                const twoPhase6 = _sh(await runShellWithRoot(
                    `echo ===T0===; ${sample6}; echo ===SLEEP===; sleep 10; echo ===T1===; ${sample6}`, 30000));
                const t06 = (twoPhase6.split('===SLEEP===')[0] || '').replace('===T0===', '');
                const t16 = (twoPhase6.split('===T1===')[1] || '');
                if (twoPhase6.includes('NOCHAIN6')) {
                    out.push('v6链不存在 → 被限速设备当前无IPv6地址或规则未重建');
                } else {
                    const d6 = sumPkts6(t16) - sumPkts6(t06);
                    out.push(`10秒内 v6命中包数增量: ${d6} 个${d6 > 0 ? ' ✓ v6流量正在被限速' : ''}`);
                    out.push('--- T1 v6链实况 ---');
                    out.push(t16.trim() || '(无输出)');
                }
            }
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('④ hashlimit 运行表（/proc/net/ipt_hashlimit）');
        try {
            const ht = _sh(await runShellWithRoot(`ls /proc/net/ipt_hashlimit/ 2>/dev/null || echo NODIR`));
            out.push(ht.includes('NODIR') ? '目录不存在 → 没有任何 hashlimit 规则在生效' : ht.trim());
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('⑤ 硬件转发加速检测（存在 = 流量绕过 netfilter，限速对其无效）');
        try {
            const a = _sh(await runShellWithRoot(`lsmod 2>/dev/null | grep -iE 'shortcut|sfe|ecm_|nss|fast' || echo NOACC`));
            out.push(a.includes('NOACC') ? '未检测到加速模块 ✓' : '⚠ 检测到: ' + a.trim());
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('⑥ filter FORWARD 挂载点（看 KANO_LIMIT 跳转是否被命中）');
        try {
            const f = _sh(await runShellWithRoot(`${IPT} -t filter -nvxL FORWARD 2>/dev/null | head -n 6`));
            out.push(f.trim() || '(无输出)');
        } catch (e) { out.push('检测异常: ' + (e?.message || e)); }

        sec('判读指南');
        out.push('· ①无hashlimit 或 ②exit非0 → 内核不支持/拒绝，错误文本即原因');
        out.push('· ③设备带IPv6地址 + ③a增量为0 + ③b未启用/无v6规则 → 流量走了IPv6，v4规则管不着：开启IPv6后重设限速');
        out.push('· ③a设备跑流量期间增量仍为0（且③设备无IPv6）→ 包没过此链：⑤有加速模块则是被它绕过；无加速则可能走了 USB 直连等非 FORWARD 路径');
        out.push('· ④无 ku_ 开头的表项 → hashlimit 规则实际未生效');
        out.push('· ③a/③b增量在涨但仍不限速 → 规则生效中，请把本报告发给开发者');
        out.push('· 注意：限速规则每30秒重建一次，链上 pkts 计数只反映最近≤30秒，以双采样增量为准');
        return out.join('\n');
    };

    const showLimitDiagModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_limit_diag_modal', title: '🚦 限速专项诊断', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;">自动采集内核/规则/命中/加速信息，直接定位限速不生效的原因<br><span style="color:#fbbf24;">采集约 25 秒（含两次 10 秒流量采样）——期间请让被限速设备持续跑流量（测速/看视频），否则无法判断包是否经过限速链</span></div>
                <textarea readonly style="width:100%;height:50vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">收集中（约25秒），期间请让被限速设备保持跑流量...</textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
                    <button id="kano_ldiag_copy" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
                </div>`
        });
        showModal(id);
        const report = await runLimitDiag();
        const ta = el.querySelector('textarea');
        if (ta) ta.value = report;
        _log('LIMIT', '已生成限速专项诊断报告');
        el.querySelector('#kano_ldiag_copy')?.addEventListener('click', async () => {
            const ok = await copyTextSafe(report, ta);
            createToast(ok ? '诊断报告已复制' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 4000);
        });
    };

    // ============================================================
    //  v20.1.3(I2): 一键导出诊断包 —— 版本环境 + 异常流量审计 + 限速诊断 + 全部日志，一次复制发回
    // ============================================================

    // 文本版异常流量审计（与诊断弹窗同一判定逻辑，>1GB设备三档判读）
    const collectAuditText = async () => {
        const out = [];
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null || echo '{}'`); // v20.1.6(K4): _shUser 仅一个参数，删除多余第二参数
            let data = {};
            try { data = JSON.parse(_sh(r).trim() || '{}'); } catch (e) {}
            const _g = (b) => ((b || 0) / 1e9).toFixed(2) + 'GB';
            let found = false;
            for (const [mac, h] of Object.entries(data)) {
                const total = (h.totalUp || 0) + (h.totalDown || 0) + (h.curUp || 0) + (h.curDown || 0);
                if (total <= 1 * 1024 * 1024 * 1024) continue;
                found = true;
                const cur = (h.curUp || 0) + (h.curDown || 0);
                const hist = (h.totalUp || 0) + (h.totalDown || 0);
                const ratio = cur > 0 ? hist / cur : (hist > 0 ? 999 : 0);
                const v6n = (h.ip6s || (h.ip6 ? [h.ip6] : [])).length;
                const ledgerN = Object.keys(h.addrUp || {}).length;
                const devName = customNames[mac] || h.hostname || mac;
                let verdict;
                if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024 && v6n >= 2) {
                    verdict = '🔴 符合多IPv6轮换重复累加特征（旧版产生的脏数据），历史累计被反复滚入 → 建议「清除全部流量」';
                } else if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024) {
                    verdict = '🟡 历史累计远大于当前计数：经历过大量计数重置/地址更替，或为长期跨周期正常累计，结合设备实际用量判断';
                } else {
                    verdict = '🟢 未见异常累加特征';
                }
                out.push(`设备: ${devName} (${mac})`);
                out.push(`  上行: 历史${_g(h.totalUp)} + 当前${_g(h.curUp)}`);
                out.push(`  下行: 历史${_g(h.totalDown)} + 当前${_g(h.curDown)}`);
                out.push(`  IPv6地址 ${v6n}个 · 计数台账 ${ledgerN}条 · 历史/当前比 ${ratio === 999 ? '∞' : ratio.toFixed(1) + 'x'}`);
                out.push(`  判定: ${verdict}`);
            }
            if (!found) out.push('未发现 >1GB 的设备，流量分布正常');
        } catch (e) { out.push('审计采集异常: ' + (e?.message || e)); }
        return out.join('\n');
    };

    const exportDiagPack = async () => {
        const L = [];
        L.push('======== 设备流量监控 · 诊断包 ========');
        L.push(`插件版本: v21.0.4`);
        L.push(`采集时间: ${new Date().toLocaleString()}`);
        try { L.push(`UFI-TOOLS版本: ${(typeof UFI_DATA !== 'undefined' && UFI_DATA?.app_ver) || '未知'}`); } catch (e) {}
        L.push(`环境: iptables=${hasIptables ? IPT : '无'} ip6tables=${hasIp6tables ? IP6T : '无'} IPv6统计=${enableIPv6 ? '开' : '关'} 限速模块=${limitMode || '不可用'}`);
        // v21.0.0: 统计引擎状态
        try {
            const engSt = await getEngineStatus();
            const engNow = await readEngineJson(true);
            L.push(`统计引擎: ${engNow ? '运行中(引擎统计模式)' : engSt.installed ? '已安装未运行(已回退iptables)' : '未安装(iptables模式)'} · 版本=${engSt.ver || '无'} · WAN=${(engNow && engNow.wan) || '--'} · acct=${engSt.acct} · zeroStreak=${(engNow && engNow.summary && engNow.summary.zeroStreak) || 0}`);
        } catch (e) { L.push('统计引擎: 状态采集异常 ' + (e?.message || e)); }
        L.push(`设备: 在线${deviceList.length}台 · 历史${Object.keys(trafficHistory).length}台 · 限速中${Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length}台`);
        L.push('');
        L.push('======== ① 异常流量审计 ========');
        L.push(await collectAuditText());
        L.push('');
        L.push('======== ② 限速专项诊断 ========');
        L.push(hasActiveLimits() ? await runLimitDiag() : '(当前无限速配置，跳过)');
        L.push('');
        L.push('======== ③ 运行日志 ========');
        L.push(await readLogFile());
        L.push('');
        // v20.1.6(K2): 连接方式与接口 —— 排查"有线设备没统计"类问题
        L.push('======== ④ 连接方式与接口 ========');
        try {
            let wifiN = 0, wiredN = 0, unknownN = 0;
            for (const d of deviceList) {
                if (d.connType === '无线') wifiN++;
                else if (d.connType === '有线') wiredN++;
                else unknownN++;
            }
            L.push(`连接方式分布: 无线 ${wifiN} 台 · 有线 ${wiredN} 台 · 未知 ${unknownN} 台`);
            const rIf = await runShellWithRoot(`ls /sys/class/net/ 2>/dev/null || echo ''`);
            const ifaces = _sh(rIf).split(/\s+/).map(s => s.trim()).filter(s => s && s !== 'lo' && !/^(wwan|rmnet|ccmni|pdp|ccni)/.test(s));
            L.push(`网络接口: ${ifaces.length ? ifaces.join(' ') : '未能枚举'}`);
            L.push('说明: 统计不区分有线/无线，转发流量均计数；有线口下接路由器/电脑时只能看到该设备本身，其 NAT 后设备的流量并入它统计（拓扑决定，非统计遗漏）');
        } catch (e) { L.push('采集异常: ' + (e?.message || e)); }
        L.push('');
        L.push('======== 诊断包结束 ========');
        return L.join('\n');
    };

    const showExportModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_export_modal', title: '📦 一键导出诊断包', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;line-height:1.6;">自动打包：异常流量审计 + 限速诊断 + 全部运行日志<br><span style="color:#fbbf24;">采集约 25 秒（含限速流量采样）——若有限速问题，期间请让被限速设备保持跑流量</span><br>采集完成后点「复制全部」，粘贴发送给开发者即可</div>
                <textarea readonly style="width:100%;height:50vh;font-size:11px;line-height:1.5;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;color:inherit;resize:none;font-family:monospace;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;">正在采集诊断包（约25秒），请稍候...</textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
                    <button id="kano_export_copy" disabled style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">复制全部</button>
                </div>`
        });
        showModal(id);
        const pack = await exportDiagPack();
        const ta = el.querySelector('textarea');
        if (ta) ta.value = pack;
        const copyBtn = el.querySelector('#kano_export_copy');
        if (copyBtn) copyBtn.disabled = false;
        _log('DIAG', '已生成一键诊断包');
        copyBtn?.addEventListener('click', async () => {
            const ok = await copyTextSafe(pack, ta);
            createToast(ok ? '诊断包已复制，粘贴发送给开发者即可' : '复制失败，请长按文本全选后手动复制', ok ? 'green' : 'pink', 5000);
        });
    };

    // ============================================================
    //  v21.0.0(P4): 引擎管理弹窗 —— 状态面板 + 云端安装/更新 + 启停控制
    // ============================================================
    const showEngineModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_engine_modal', title: '⚙️ 统计引擎 (kano_engine)', maxWidth: 'min(480px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div id="kano_engine_content" style="font-size:12px;line-height:1.6;"><div style="text-align:center;padding:20px;opacity:.5;">检测中...</div></div>`
        });
        showModal(id);
        const contentEl = el.querySelector('#kano_engine_content');

        const render = async () => {
            if (!contentEl) return;
            contentEl.innerHTML = '<div style="text-align:center;padding:20px;opacity:.5;">检测中...</div>';
            const st = await getEngineStatus();
            const eng = await readEngineJson(true);
            const cloud = await fetchManifest();
            const sum = eng && eng.summary ? eng.summary : {};
            const item = (k, v, color) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="opacity:.75;">${k}</span><span style="font-weight:600;text-align:right;${color ? 'color:' + color + ';' : ''}">${v}</span></div>`;
            let html = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-bottom:10px;">';
            html += item('统计模式', eng ? '引擎 (conntrack+sysfs)' : 'iptables 计数链' + (st.installed ? '（引擎未运行，已回退）' : '（引擎未安装）'), eng ? '#4ade80' : '#fbbf24');
            html += item('引擎安装', st.installed ? `已安装 v${st.ver || '?'} · ${(st.binSize / 1024).toFixed(1)}KB` : '未安装', st.installed ? '#4ade80' : '#f87171');
            html += item('运行状态', st.running ? '运行中' : '已停止', st.running ? '#4ade80' : '#f87171');
            html += item('数据新鲜度', st.jsonAge >= 0 && st.jsonAge < 30 ? st.jsonAge + 's 前 ✓' : (st.jsonAge >= 30 ? st.jsonAge + 's 前（过期）' : '无数据'), st.jsonAge >= 0 && st.jsonAge < 30 ? '#4ade80' : '#f87171');
            html += item('conntrack 记账', st.acct === '1' ? '已开启' : '未开启(' + st.acct + ')', st.acct === '1' ? '#4ade80' : '#f87171');
            html += item('开机自启', st.boot ? '已启用' : '未启用', st.boot ? '#4ade80' : '#fbbf24');
            if (eng) {
                const zs = sum.zeroStreak || 0;
                html += item('WAN 口', eng.wan || '--');
                html += item('在线设备', (sum.deviceCount != null ? sum.deviceCount : Object.keys(eng.devices || {}).length) + ' 台');
                html += item('引擎累计', 'WAN总 ' + formatBytes(sum.sysDeltaBytes || 0) + ' · 设备合计 ' + formatBytes(sum.deviceTotalBytes || 0));
                html += item('零增量周期', zs > 12 ? zs + ' ⚠ 疑似硬件转发绕过 conntrack' : String(zs), zs > 12 ? '#f87171' : '');
            }
            html += item('云端最新版', cloud ? 'v' + cloud.rev + (cloud.rev === st.ver ? '（已是最新）' : '（可更新）') : '获取失败', cloud ? (cloud.rev === st.ver ? '#4ade80' : '#fbbf24') : '#f87171');
            // v21.0.1(Q3): 二进制与云端 md5 比对, 下载损坏一眼可见
            if (st.installed) {
                const md5ok = cloud && cloud.md5 ? (st.md5 === String(cloud.md5).trim()) : null;
                html += item('二进制校验', md5ok === null ? (st.md5 ? st.md5.slice(0, 12) + '…（云端清单未知）' : '读取失败') : (md5ok ? '✓ 与云端一致' : '✗ 与云端不一致，请云端重装'), md5ok === false ? '#f87171' : (md5ok ? '#4ade80' : ''));
            }
            // v21.0.2(R4): 插件自身云端版本(独立于引擎版本)
            const jsNewer = !!(cloud && cloud.jsRev && _verNewer(cloud.jsRev, PLUGIN_VERSION));
            html += item('插件云端版', cloud ? (cloud.jsRev ? 'v' + cloud.jsRev + (jsNewer ? '（可更新）' : '（已是最新）') : '清单无插件版本号') : '获取失败', jsNewer ? '#fbbf24' : (cloud && cloud.jsRev ? '#4ade80' : '#f87171'));
            html += '</div>';
            const btnStyle = 'font-size:11px;padding:4px 12px;border-radius:4px;cursor:pointer;border:1px solid ';
            const btnSm = 'font-size:10px;padding:3px 9px;border-radius:4px;cursor:pointer;border:1px solid '; // v21.0.4(T2)
            html += `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                <button id="kano_eng_deploy" style="${btnStyle}rgba(74,222,128,0.3);background:rgba(74,222,128,0.12);color:#4ade80;">${st.installed ? '⬇️ 云端更新/重装' : '⬇️ 云端安装'}</button>
                <button id="kano_eng_restart" style="${btnStyle}rgba(251,191,36,0.25);background:rgba(251,191,36,0.1);color:#fbbf24;" ${st.installed ? '' : 'disabled'}>重启</button>
                ${st.running
                    ? `<button id="kano_eng_stop" style="${btnStyle}rgba(248,113,113,0.25);background:rgba(248,113,113,0.1);color:#f87171;">停止</button>`
                    : `<button id="kano_eng_start" style="${btnStyle}rgba(56,189,248,0.25);background:rgba(56,189,248,0.1);color:#38bdf8;" ${st.installed ? '' : 'disabled'}>启动</button>`}
                <button id="kano_js_update" style="${btnStyle}rgba(251,146,60,0.25);background:rgba(251,146,60,0.1);color:#fb923c;" ${cloud && cloud.js ? '' : 'disabled'}>🔄 更新插件${jsNewer ? ' v' + cloud.jsRev : ''}</button>
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;margin-top:6px;opacity:.8;">
                <button id="kano_eng_refresh" style="${btnSm}rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:inherit;">刷新</button>
                <button id="kano_eng_selftest" style="${btnSm}rgba(52,211,153,0.25);background:rgba(52,211,153,0.1);color:#34d399;" ${st.installed ? '' : 'disabled'}>🔍 自检</button>
                <button id="kano_eng_nettest" style="${btnSm}rgba(167,139,250,0.25);background:rgba(167,139,250,0.1);color:#a78bfa;">☁️ 连通性</button>
                <button id="kano_eng_uninstall" style="${btnSm}rgba(248,113,113,0.25);background:rgba(248,113,113,0.08);color:#f87171;" ${st.installed ? '' : 'disabled'}>🗑 卸载引擎</button>
            </div>`;
            html += `<div style="font-size:10px;opacity:.45;margin-top:8px;line-height:1.6;">引擎直读内核 conntrack 记账(bytes=)+WAN口 sysfs，页面关闭期间持续统计；引擎不可用时自动回退 iptables 计数链，数据不间断。<br>部署来源: jsDelivr CDN · 468133/kano-engine-assets${cloud && cloud.notes ? '<br>更新说明: ' + escHtml(cloud.notes) : ''}</div>`;
            contentEl.innerHTML = html;

            contentEl.querySelector('#kano_eng_deploy')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true; ev.target.textContent = '部署中...';
                await installOrUpdateEngine();
                await render();
            });
            contentEl.querySelector('#kano_eng_restart')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true;
                await stopEngine(false);
                await startEngine();
                _engineJsonCache = { t: 0, data: null };
                createToast('引擎已重启', 'green');
                await render();
            });
            contentEl.querySelector('#kano_eng_stop')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true;
                await stopEngine(true); // 主动停止同时摘除自启，统计回退 iptables
                createToast('引擎已停止，统计已回退 iptables 计数链', 'pink', 4000);
                await render();
            });
            contentEl.querySelector('#kano_eng_start')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true;
                const ok = await startEngine();
                createToast(ok ? '引擎已启动' : '引擎启动失败，详见日志', ok ? 'green' : 'red', 4000);
                await render();
            });
            contentEl.querySelector('#kano_eng_refresh')?.addEventListener('click', render);
            // 云端连通性测试: 浏览器/设备两侧逐个源实测, 结果直接展示, 失败一眼定位是哪侧哪个源不通
            contentEl.querySelector('#kano_eng_nettest')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true; ev.target.textContent = '测试中...';
                const cands = assetCandidates(ENGINE_MANIFEST_URL);
                const lines = [];
                for (const u of cands) {
                    let res;
                    try {
                        const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
                        res = r.ok ? `HTTP ${r.status} ✓` : `HTTP ${r.status}`;
                    } catch (e) { res = '失败: ' + (e && e.message || e); }
                    lines.push({ u, side: '浏览器', res });
                }
                try {
                    const CURL = '/data/data/com.minikano.f50_sms/files/curl';
                    const urls = cands.map(u => `'${u}'`).join(' ');
                    const cmd = `C=curl; [ -x ${CURL} ] && C=${CURL}; [ -x "$C" ] || which $C >/dev/null 2>&1 || echo NOCURL; ` +
                        `for u in ${urls}; do code=$($C -fsSL -o /dev/null -w '%{http_code}' --connect-timeout 6 --max-time 15 "$u" 2>/dev/null); echo "T $u \${code:-000}"; done`;
                    const r = await runShellWithRoot(cmd, 120000); // 显式超时: 默认超时会在多源轮询时掐死命令导致空输出
                    const out = _sh(r);
                    const outLines = out.split('\n');
                    let hitCount = 0;
                    for (const u of cands) {
                        const hit = outLines.find(l => l.startsWith('T ' + u + ' '));
                        const code = hit ? hit.trim().split(/\s+/).pop() : null;
                        if (hit) hitCount++;
                        lines.push({ u, side: '设备', res: code ? (code === '200' ? 'HTTP 200 ✓' : 'HTTP ' + code) : '无结果' });
                    }
                    if (out.includes('NOCURL')) lines.push({ u: '', side: '设备', res: '⚠ 设备无 curl 命令' });
                    // 一条 T 行都没有 = 命令本身没跑起来(超时/语法/shell异常), 回显原始输出便于定位
                    if (hitCount === 0) lines.push({ u: '', side: '设备', res: '原始输出: ' + (out.trim().slice(0, 200) || '(空)') });
                } catch (e) { lines.push({ u: '', side: '设备', res: '测试异常: ' + (e && e.message || e) }); }
                const okLines = lines.filter(l => l.res.includes('✓'));
                _log('ENGINE', `云端连通性: 通=${okLines.length}/${lines.length}${okLines.length ? ' [' + okLines.map(l => l.side + '@' + (l.u.split('/')[2] || '')).join(',') + ']' : ' 全部不通'}`);
                const html = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;line-height:1.7;">' +
                    '<div style="font-weight:600;margin-bottom:4px;">☁️ 云端连通性测试结果</div>' +
                    lines.map(l => `<div style="display:flex;justify-content:space-between;gap:8px;"><span style="opacity:.7;">${l.side}${l.u ? ' · ' + escHtml(l.u.split('/')[2] || l.u) : ''}</span><span style="${l.res.includes('✓') ? 'color:#4ade80;' : 'color:#f87171;'}">${escHtml(l.res)}</span></div>`).join('') +
                    '</div>';
                contentEl.insertAdjacentHTML('beforeend', html);
                ev.target.disabled = false; ev.target.textContent = '☁️ 云端连通性测试';
            });
            // v21.0.3(S1): 引擎自检两段式 —— 原实现单条 shell ≈13s, 被宿主约10s强杀(signal is aborted);
            //              改为短命令后台试跑(结果写文件) + JS等待 + 短命令读回, 全程暂停监控tick独占shell通道
            //              退出码判读: 139=段错误 / 124=阻塞超时 / 0=正常
            contentEl.querySelector('#kano_eng_selftest')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true; ev.target.textContent = '自检中...';
                const SELFTEST_OUT = '/data/data/com.minikano.f50_sms/kano_selftest.out';
                let out = '';
                _refreshing = true; // S1: 自检期间暂停监控tick, 独占shell通道, 杜绝并发抢通道导致的 abort
                try {
                    const cmdA = `echo "== 引擎自检 $(date '+%Y/%m/%d %H:%M:%S') =="; ` +
                        `if [ -x ${ENGINE_BIN} ]; then echo "二进制: $(stat -c %s ${ENGINE_BIN} 2>/dev/null)字节 md5=$(md5sum ${ENGINE_BIN} 2>/dev/null | awk '{print $1}')"; else echo "二进制: 缺失"; fi; ` +
                        `echo "acct=$(awk '{print}' /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null) conntrack行数=$(wc -l < /proc/net/nf_conntrack 2>/dev/null)"; ` +
                        `if [ -f ${ENGINE_PID} ]; then kill $(cat ${ENGINE_PID} 2>/dev/null) 2>/dev/null; sleep 1; fi; rm -f ${ENGINE_PID}; ` +
                        `rm -f ${SELFTEST_OUT}; nohup sh -c 'timeout 12s ${ENGINE_BIN} --once >${SELFTEST_OUT} 2>&1; echo "退出码=$?" >>${SELFTEST_OUT}' >/dev/null 2>&1 & echo SELFTEST_LAUNCHED`;
                    const r1 = await runShellWithRoot(cmdA);
                    _logCmd('引擎自检(1/2 环境+启动试跑)', cmdA, r1);
                    await new Promise(res => setTimeout(res, 14000)); // 等前台试跑收尾(12s超时+2s余量)
                    const cmdB = `echo "-- 前台试跑 kano_engine --once (12s超时) --"; cat ${SELFTEST_OUT} 2>/dev/null || echo '(无输出)'; rm -f ${SELFTEST_OUT}; ` +
                        `echo "-- 引擎阶段日志尾部 --"; tail -n 25 ${ENGINE_LOG} 2>/dev/null || echo '(无日志)'; ` +
                        `echo "-- JSON 落盘检查 --"; if [ -f ${ENGINE_JSON} ]; then ls -la ${ENGINE_JSON}; head -c 400 ${ENGINE_JSON} 2>/dev/null; echo; else echo "JSON: 未生成"; fi`;
                    const r2 = await runShellWithRoot(cmdB);
                    _logCmd('引擎自检(2/2 结果)', cmdB, r2);
                    out = (_sh(r1).trim() + '\n' + _sh(r2).trim()).trim() || '(无输出)';
                } catch (e) {
                    out = '自检异常: ' + (e && e.message || e);
                    _log('ERR', `引擎自检异常: ${e && e.message || e}`);
                }
                _refreshing = false;
                await startEngine(); // 自检杀了常驻实例, 无论结果如何都拉回
                const html = '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-top:10px;">' +
                    '<div style="font-weight:600;font-size:11px;margin-bottom:4px;">🔍 引擎自检结果(已写入运行日志)</div>' +
                    `<pre style="font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;margin:0;opacity:.9;">${escHtml(out)}</pre></div>`;
                contentEl.insertAdjacentHTML('beforeend', html);
                ev.target.disabled = false; ev.target.textContent = '🔍 引擎自检';
            });
            // v21.0.2(R4): 插件自更新 —— 成功后自动刷新页面, 失败恢复按钮可重试
            contentEl.querySelector('#kano_js_update')?.addEventListener('click', async (ev) => {
                ev.target.disabled = true; ev.target.textContent = '更新中...';
                const ok = await updatePluginSelf(cloud);
                if (!ok) { ev.target.disabled = false; ev.target.textContent = '🔄 更新插件'; }
            });
            // v21.0.2(R3): 单独卸载引擎(双击确认, 与清除日志同款防呆) —— 插件数据/统计不动
            const unBtn = contentEl.querySelector('#kano_eng_uninstall');
            let engUnArm = false, engUnTimer = null;
            unBtn?.addEventListener('click', async () => {
                if (!engUnArm) {
                    engUnArm = true;
                    unBtn.textContent = '再点一次确认卸载';
                    engUnTimer = setTimeout(() => { engUnArm = false; unBtn.textContent = '🗑 卸载引擎'; }, 3000);
                    return;
                }
                clearTimeout(engUnTimer);
                unBtn.disabled = true; unBtn.textContent = '卸载中...';
                await uninstallEngine();
                await render();
            });
        };
        await render();
    };

    const showLimitModal = (mac) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const h = trafficHistory[mac];
        if (!dev && !h) return;
        const name = dev ? dev.hostname : (customNames[mac] || h.hostname || defaultDeviceName(h.ip));
        const ip = dev ? (dev.ip || '') : (h.ip || '');
        const ip6s = dev ? (dev.ip6s || []) : (h.ip6s || (h.ip6 ? [h.ip6] : []));
        const cur = deviceLimits[mac] || {};

        // v20.1.6(K4): 存档 unit key 非法时回退 KB/s（原 LIMIT_UNITS[非法key] 为 undefined 直接 TypeError 崩弹窗）
        const curUpUnit = LIMIT_UNITS[cur.upUnit] ? cur.upUnit : 'KB/s';
        const curDownUnit = LIMIT_UNITS[cur.downUnit] ? cur.downUnit : 'KB/s';
        const curUpVal = cur.up ? (cur.up / LIMIT_UNITS[curUpUnit].factor).toFixed(curUpUnit === 'KB/s' ? 0 : 2).replace(/\.0+$/, '') : '';
        const curDownVal = cur.down ? (cur.down / LIMIT_UNITS[curDownUnit].factor).toFixed(curDownUnit === 'KB/s' ? 0 : 2).replace(/\.0+$/, '') : '';

        const unitOptions = (selected) => Object.keys(LIMIT_UNITS).map(u => 
            `<option value="${u}" ${u === selected ? 'selected' : ''}>${LIMIT_UNITS[u].label}</option>`
        ).join('');

        const modeText = limitMode === 'hashlimit'
            ? 'hashlimit 精确限速（按字节）'
            : limitMode === 'limit'
                ? 'limit 近似限速（当前内核仅支持按包限速，为近似值）'
                : '内核不支持限速模块（hashlimit/limit 均不可用）';
        const modeColor = limitMode === 'hashlimit' ? '#4ade80' : limitMode === 'limit' ? '#fbbf24' : '#f87171';

        const { id, el } = createModal({
            name: 'traffic_limit_modal', title: '⏱ 设备限速', maxWidth: 'min(380px, 94vw)',
            showConfirm: true, confirmBtnText: '保存', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                if (limitMode === null) {
                    createToast('内核不支持限速模块', 'red', 4000);
                    return true;
                }
                const upVal = parseFloat(el.querySelector('#limit_up_input')?.value) || 0;
                const downVal = parseFloat(el.querySelector('#limit_down_input')?.value) || 0;
                const upUnit = el.querySelector('#limit_up_unit')?.value || 'KB/s';
                const downUnit = el.querySelector('#limit_down_unit')?.value || 'KB/s';
                const upKB = Math.max(0, Math.round(upVal * LIMIT_UNITS[upUnit].factor));
                const downKB = Math.max(0, Math.round(downVal * LIMIT_UNITS[downUnit].factor));

                if (upKB === 0 && downKB === 0) {
                    delete deviceLimits[mac];
                    await saveLimits();
                    await applyLimits();
                    renderList();
                    createToast('已取消限速: ' + name, 'green');
                    _log('LIMIT', `取消限速 mac=${mac}`);
                } else {
                    deviceLimits[mac] = { up: upKB, down: downKB, upUnit, downUnit };
                    await saveLimits();
                    await applyLimits();
                    renderList();
                    const upStr = upKB > 0 ? `${upVal}${upUnit}` : '不限';
                    const downStr = downKB > 0 ? `${downVal}${downUnit}` : '不限';
                    createToast(`已限速: 上行${upStr} 下行${downStr}`, 'green');
                    _log('LIMIT', `设置限速 mac=${mac} up=${upKB}KB/s down=${downKB}KB/s mode=${limitMode}`);
                }
                return true;
            },
            content: `<div style="font-size:13px;margin-bottom:10px;opacity:.7;">
                    设备: <strong style="color:var(--dark-btn-color-active);">${escHtml(name)}</strong><br>
                    MAC: <span style="font-family:monospace;">${mac}</span><br>
                    IP: ${escHtml(ip) || '--'}${ip6s.length ? ' <span style="font-size:10px;opacity:.6;">+v6(' + ip6s.length + ')</span>' : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <div>
                        <label style="font-size:12px;opacity:.8;display:block;margin-bottom:4px;">上行限速</label>
                        <div style="display:flex;gap:6px;">
                            <input id="limit_up_input" type="number" min="0" step="any" value="${curUpVal}" placeholder="0 = 不限" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;box-sizing:border-box;">
                            <select id="limit_up_unit" style="padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${unitOptions(curUpUnit)}</select>
                        </div>
                    </div>
                    <div>
                        <label style="font-size:12px;opacity:.8;display:block;margin-bottom:4px;">下行限速</label>
                        <div style="display:flex;gap:6px;">
                            <input id="limit_down_input" type="number" min="0" step="any" value="${curDownVal}" placeholder="0 = 不限" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;box-sizing:border-box;">
                            <select id="limit_down_unit" style="padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${unitOptions(curDownUnit)}</select>
                        </div>
                    </div>
                </div>
                <div style="margin-top:12px;font-size:11px;opacity:.5;line-height:1.6;">
                    0 或留空 = 不限；两项均为 0 = 删除限速<br>
                    多地址设备每个地址独立限速（不拆分额度）<br>
                    被限速丢弃的包仍会计入流量统计<br>
                    当前模式: <span style="color:${modeColor};">${modeText}</span>
                </div>
                <button id="limit_diag_btn" style="width:100%;margin-top:10px;padding:8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:6px;color:#38bdf8;cursor:pointer;font-size:12px;">🔍 限速不生效？点我一键诊断</button>`
        });
        showModal(id);
        setTimeout(() => { el.querySelector('#limit_up_input')?.focus(); }, 100);
        el.querySelector('#limit_diag_btn')?.addEventListener('click', () => showLimitDiagModal()); // v20.1.2(H3)
    };

const showDeleteConfirm = (mac, ip, ip6) => {
        if (pluginUninstalled) return;
        const dev = deviceList.find(d => d.mac === mac);
        const name = dev ? dev.hostname : (customNames[mac] || trafficHistory[mac]?.hostname || mac);
        const { id, el } = createModal({
            name: 'traffic_delete_modal', title: '删除设备记录', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '确认执行', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                const action = el.querySelector('input[name="del_action"]:checked')?.value || 'clear';
                if (action === 'clear') {
                    await delDevRules(mac);
                    await syncRules();
                    delete trafficHistory[mac];
                    await flushHistory(true);
                    renderList();
                    renderOverview();
                    createToast('已清除流量: ' + name, 'green');
                } else {
                    await delDevRules(mac);
                    delete trafficHistory[mac];
                    await flushHistory(true);
                    delete customNames[mac];
                    await saveNames();
                    deviceList = deviceList.filter(d => d.mac !== mac);
                    // 审查修复: 删除全部时同步清除该设备的限速配置与限速规则
                    if (deviceLimits[mac]) { delete deviceLimits[mac]; await saveLimits(); await applyLimits(); }
                    renderList();
                    renderOverview();
                    createToast('已删除: ' + name, 'green');
                }
                return true;
            },
            content: `
                <div style="font-size:13px;line-height:1.6;opacity:.85;">
                    <strong style="color:var(--dark-btn-color-active);">${escHtml(name)}</strong><br>
                    MAC: <span style="font-family:monospace;opacity:.7;">${mac}</span><br>
                    IP: <span style="opacity:.7;">${escHtml(ip) || '--'}</span>${ip6 ? '<br>IPv6: <span style="opacity:.7;">' + escHtml(ip6) + '</span>' : ''}<br><br>
                    <div style="display:flex;flex-direction:column;gap:8px;margin:10px 0;">
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(251,146,60,0.08);border-radius:6px;cursor:pointer;border:1px solid rgba(251,146,60,0.15);">
                            <input type="radio" name="del_action" value="clear" checked style="width:16px;height:16px;">
                            <div>
                                <div style="font-weight:bold;color:#fb923c;font-size:12px;">仅清除流量</div>
                                <div style="opacity:.5;font-size:11px;">保留自定义名称和离线记录，下次上线从零统计</div>
                            </div>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,107,107,0.08);border-radius:6px;cursor:pointer;border:1px solid rgba(255,107,107,0.15);">
                            <input type="radio" name="del_action" value="delete" style="width:16px;height:16px;">
                            <div>
                                <div style="font-weight:bold;color:#ff6b6b;font-size:12px;">删除全部</div>
                                <div style="opacity:.5;font-size:11px;">清除流量+名称+iptables规则，从列表彻底移除</div>
                            </div>
                        </label>
                    </div>
                </div>`
        });
        showModal(id);
    };
    // ============================================================
    //  诊断系统
    // ============================================================

    const _diagItem = (name, status, detail) => {
        // v20.0.1(F3): 调用方传字面字符 '✓'/'⚠'/'❌'，原与 HTML 实体比较永不命中导致全部标红
        const color = String(status).includes('✓') ? '#4ade80' : String(status).includes('⚠') ? '#fbbf24' : '#f87171';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
            <span style="opacity:.8;">${name}</span>
            <span style="color:${color};font-weight:bold;">${status}</span>
        </div>${detail ? `<div style="font-size:10px;opacity:.5;padding-left:12px;margin-bottom:4px;">${detail}</div>` : ''}`;
    };

    const _diagSection = (title, items) => {
        return `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin-bottom:10px;">
            <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:var(--dark-btn-color-active);">${title}</div>
            ${items.join('')}
        </div>`;
    };

    const showDiagModal = async () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_diag_modal', title: '🔍 系统诊断', maxWidth: 'min(520px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div style="font-size:12px;margin-bottom:8px;opacity:.6;">正在检测各模块状态...</div>
                <div id="kano_diag_loading" style="text-align:center;padding:20px;opacity:.5;">收集中，请稍候...</div>
                <div id="kano_diag_content" style="font-size:11px;line-height:1.5;max-height:480px;overflow:auto;display:none;"></div>`
        });
        showModal(id);

        const loadingEl = el.querySelector('#kano_diag_loading');
        const contentEl = el.querySelector('#kano_diag_content');

        let chainExists = false, chainRefs = 0, ruleCount = 0;
        let iptStatus = '❌', iptDetail = 'iptables 链未创建';
        let iptRaw = '';
        if (!hasIptables) {
            iptStatus = '❌';
            iptDetail = '未检测到可用的 iptables 二进制（已尝试 iptables/iptables-legacy/iptables-nft）';
        } else {
            try {
                const r = await runShellWithRoot(`${IPT} -t mangle -nvxL ${CHAIN_NAME} 2>/dev/null; echo "---EXIT---$?"`);
                iptRaw = _sh(r);
                if (iptRaw && iptRaw.includes(CHAIN_NAME)) {
                    chainExists = true;
                    const m = iptRaw.match(/\((\d+)\s*references?\)/);
                    chainRefs = m ? parseInt(m[1]) : 0;
                    ruleCount = (iptRaw.match(/RETURN/g) || []).length;
                    iptStatus = chainRefs >= 1 ? '✓' : '⚠';
                    iptDetail = `${IPT} · ${CHAIN_NAME}链 · ${chainRefs}条引用 · ${ruleCount}条RETURN规则`;
                } else if (iptRaw && iptRaw.includes('Chain')) {
                    chainExists = true;
                    iptStatus = '⚠';
                    iptDetail = `${IPT} · ${CHAIN_NAME}链存在但无规则`;
                }
            } catch(e) { iptDetail = '检测异常: ' + (e?.message || e); }
        }

        // v20: 异常流量审计
        let auditHtml = '';
        try {
            const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null || echo '{}'`); // v20.1.6(K4): _shUser 仅一个参数，删除多余第二参数
            const raw = _sh(r).trim() || '{}';
            let data = {};
            try { data = JSON.parse(raw); } catch(e) {}

            // v20.1.1(H2): 审计增强 —— 无需F12，手机上直接给出明确判定(设备名/IPv6数/台账数/历史当前比)
            let found = false;
            let auditItems = '';
            const _g = (b) => ((b || 0) / 1e9).toFixed(2) + 'GB';
            for (const [mac, h] of Object.entries(data)) {
                const total = (h.totalUp || 0) + (h.totalDown || 0) + (h.curUp || 0) + (h.curDown || 0);
                if (total > 1 * 1024 * 1024 * 1024) {
                    found = true;
                    const cur = (h.curUp || 0) + (h.curDown || 0);
                    const hist = (h.totalUp || 0) + (h.totalDown || 0);
                    const ratio = cur > 0 ? hist / cur : (hist > 0 ? 999 : 0);
                    const v6n = (h.ip6s || (h.ip6 ? [h.ip6] : [])).length;
                    const ledgerN = Object.keys(h.addrUp || {}).length;
                    const devName = customNames[mac] || h.hostname || mac;
                    let verdict, verdictColor;
                    if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024 && v6n >= 2) {
                        verdict = `⚠️ 符合多IPv6轮换重复累加特征（v20.0.2之前旧版产生的脏数据），历史累计被反复滚入 → 建议「清除全部流量」`;
                        verdictColor = '#ff6b6b';
                    } else if (ratio >= 3 && hist > 5 * 1024 * 1024 * 1024) {
                        verdict = '⚠️ 历史累计远大于当前计数：经历过大量计数重置/地址更替，或为长期跨周期正常累计，结合设备实际用量判断';
                        verdictColor = '#fbbf24';
                    } else {
                        verdict = '✅ 未见异常累加特征';
                        verdictColor = '#4ade80';
                    }
                    auditItems += `<div style="background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin-bottom:6px;">
                        <div style="font-weight:600;font-size:12px;">${escHtml(devName)}</div>
                        <div style="font-family:monospace;font-size:10px;opacity:.6;">${mac}</div>
                        <div style="font-size:11px;margin-top:3px;">上行: 历史${_g(h.totalUp)} + 当前${_g(h.curUp)}<br>下行: 历史${_g(h.totalDown)} + 当前${_g(h.curDown)}</div>
                        <div style="font-size:10px;opacity:.6;margin-top:2px;">IPv6地址 ${v6n}个 · 计数台账 ${ledgerN}条 · 历史/当前比 ${ratio === 999 ? '∞' : ratio.toFixed(1) + 'x'}</div>
                        <div style="color:${verdictColor};font-size:11px;margin-top:4px;line-height:1.5;">${verdict}</div>
                    </div>`;
                }
            }
            if (found) {
                auditHtml = `<div style="background:rgba(251,146,60,0.06);border:1px solid rgba(251,146,60,0.15);border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-weight:bold;font-size:12px;margin-bottom:6px;color:#fb923c;">📊 异常流量审计 (>1GB设备)</div>
                    ${auditItems}
                </div>`;
            } else {
                auditHtml = `<div style="background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.15);border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-weight:bold;font-size:12px;color:#4ade80;">📊 异常流量审计</div>
                    <div style="font-size:11px;opacity:.6;margin-top:4px;">未发现 >1GB 的设备，流量分布正常</div>
                </div>`;
            }
        } catch(e) { auditHtml = ''; }

        let arpCount = 0, arpStatus = '❌', arpDetail = '无法读取ARP表';
        try {
            // v20.1.6(K3): 删除内联重复实现，复用 getArpDevs（先 refreshLocalAddrs，与主流程同一过滤口径）
            await refreshLocalAddrs();
            const arpDevs = await getArpDevs();
            arpCount = arpDevs.length;
            arpStatus = arpCount > 0 ? '✓' : '⚠';
            arpDetail = `发现 ${arpCount} 个有效设备`;
        } catch(e) { arpDetail = '检测异常: ' + (e?.message || e); }

        // v20.1.6(K2): 连接方式分布 + LAN 接口枚举 —— 排查"有线设备没统计"类问题
        let wifiN = 0, wiredN = 0, unknownN = 0;
        for (const d of deviceList) {
            if (d.connType === '无线') wifiN++;
            else if (d.connType === '有线') wiredN++;
            else unknownN++;
        }
        let ifaces = [];
        try {
            const rIf = await runShellWithRoot(`ls /sys/class/net/ 2>/dev/null || echo ''`);
            ifaces = _sh(rIf).split(/\s+/).map(s => s.trim()).filter(s => s && s !== 'lo' && !/^(wwan|rmnet|ccmni|pdp|ccni)/.test(s));
        } catch (e) {}

        let namesExist = false, historyExist = false, snapsExist = false, limitsExist = false;
        let namesSize = 0, historySize = 0, snapsSize = 0, limitsSize = 0;
        let persistStatus = '❌', persistDetail = '文件系统不可写';

        try { const r = await _shUser(`ls ${NAMES_FILE} >/dev/null 2>&1 && echo yes || echo no`); namesExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${STORAGE_FILE} >/dev/null 2>&1 && echo yes || echo no`); historyExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${SNAPSHOTS_FILE} >/dev/null 2>&1 && echo yes || echo no`); snapsExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`ls ${LIMITS_FILE} >/dev/null 2>&1 && echo yes || echo no`); limitsExist = _sh(r).includes('yes'); } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${NAMES_FILE} 2>/dev/null | wc -c || echo 0`); namesSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${STORAGE_FILE} 2>/dev/null | wc -c || echo 0`); historySize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${SNAPSHOTS_FILE} 2>/dev/null | wc -c || echo 0`); snapsSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}
        try { const r = await _shUser(`timeout 2s awk '{print}' ${LIMITS_FILE} 2>/dev/null | wc -c || echo 0`); limitsSize = parseInt(_sh(r).trim()) || 0; } catch(e) {}

        let writeTest = false;
        try {
            const testFile = '/data/data/com.minikano.f50_sms/.diag_test';
            await _shUser(`echo '{"test":1}' > ${testFile}`);
            const r2 = await _shUser(`timeout 2s awk '{print}' ${testFile}`);
            writeTest = r2.success && _sh(r2).includes('test');
            await _shUser(`rm -f ${testFile}`);
        } catch(e) {}

        if (writeTest) {
            persistStatus = '✓';
            persistDetail = `名称${namesExist?'✓':'✗'} 流量${historyExist?'✓':'✗'} 归档${snapsExist?'✓':'✗'} 限速${limitsExist?'✓':'✗'} · 可读写`;
        } else if (namesExist || historyExist || snapsExist) {
            persistStatus = '⚠';
            persistDetail = `名称${namesExist?'✓':'✗'} 流量${historyExist?'✓':'✗'} 归档${snapsExist?'✓':'✗'} 限速${limitsExist?'✓':'✗'} · 文件可读`;
        }

        const archiveStatus = autoArchiveTimer ? '✓' : '⚠';
        const archiveDetail = autoArchiveTimer
            ? `每日${archiveSettings.dailyEnabled?'✓':'✗'}${String(archiveSettings.dailyHour).padStart(2,'0')}:${String(archiveSettings.dailyMinute).padStart(2,'0')} · 每月${archiveSettings.monthlyEnabled?'✓':'✗'}${archiveSettings.monthlyDay}日`
            : '自动归档未启动';

        const fmtBytes = (b) => b > 1024*1024 ? (b/1024/1024).toFixed(1)+'MB' : b > 1024 ? (b/1024).toFixed(1)+'KB' : b+'B';
        let totalTraffic = 0;
        for (const d of deviceList) totalTraffic += getTraffic(d.mac).total;

        // v21.0.0: 统计引擎状态(诊断节)
        let engDiagStatus = '⚠ 未安装', engDiagDetail = '使用 iptables 计数链统计；点「🛠️ 引擎」可云端安装 conntrack 引擎';
        try {
            const engSt = await getEngineStatus();
            const engNow = await readEngineJson(true);
            if (engNow) {
                engDiagStatus = '✓ 引擎统计中';
                engDiagDetail = `v${engSt.ver || '?'} · WAN ${engNow.wan || '--'} · 设备 ${(engNow.summary && engNow.summary.deviceCount != null) ? engNow.summary.deviceCount : Object.keys(engNow.devices || {}).length} 台 · zeroStreak ${(engNow.summary && engNow.summary.zeroStreak) || 0}`;
            } else if (engSt.installed) {
                engDiagStatus = '⚠ 已安装未运行';
                engDiagDetail = `v${engSt.ver || '?'} · 已回退 iptables 计数链(数据不间断) · 点「🛠️ 引擎」启动`;
            }
        } catch (e) {}

        const btnItems = [
            _diagItem('刷新', '✓', '正常 · 完整流程(建链+发现+规则同步+强制落盘)'),
            _diagItem('自动监控', monitorTimer ? '✓ 运行中' : '⚠ 停止', monitorTimer ? `每${getRefreshInterval()/1000}秒刷新流量，约每30秒同步设备与规则` : '点击启动'),
            _diagItem('诊断', '✓', '当前正在使用'),
            _diagItem('日志', '✓', '运行日志记录与导出'),
            _diagItem('设置', '✓', '归档时间+删除数据'),
            _diagItem('UI切换', '✓', `当前${uiMode==='mobile'?'手机':'桌面'}视图`),
            _diagItem('归档并重计', '✓', `${snapshots.length}条历史归档`),
            _diagItem('查看历史', snapshots.length > 0 ? '✓' : '⚠', snapshots.length > 0 ? `${snapshots.length}条可查看` : '暂无归档记录'),
            _diagItem('流量排行', deviceList.length > 0 ? '✓' : '⚠', deviceList.length > 0 ? `${deviceList.length}个设备可排行` : '暂无设备'),
            _diagItem('清除全部流量', '✓', '保留名称 · 清空计数'),
            _diagItem('卸载插件', '✓', '彻底清理所有数据和规则'),
        ];

        const sections = [
            _diagSection('📊 流量统计核心', [
                _diagItem('统计引擎', engDiagStatus, engDiagDetail),
                _diagItem('iptables 链', iptStatus, iptDetail),
                _diagItem('设备发现', arpStatus, arpDetail),
                _diagItem('当前总流量', '✓', `${fmtBytes(totalTraffic)} · ${deviceList.length}在线 · ${Object.keys(trafficHistory).length}历史`),
                _diagItem('IPv6 支持', hasIp6tables ? (enableIPv6 ? '✓ 已启用' : '⚠ 可用但未启用') : '❌ 不可用',
                    hasIp6tables ? `${IP6T} 可用${enableIPv6 ? '，正在统计(多地址跟踪)' : '，设置中可开启'}` : '系统未安装 ip6tables'),
                _diagItem('限速模块', limitMode === 'hashlimit' ? '✓ hashlimit' : limitMode === 'limit' ? '⚠ limit' : '❌ 不可用',
                    (limitMode === 'hashlimit' ? '精确限速(按字节)' : limitMode === 'limit' ? '近似限速(按包pps)' : 'hashlimit/limit 均不可用，限速功能已禁用') + ` · ${Object.values(deviceLimits).filter(l => l && ((parseInt(l.up) || 0) > 0 || (parseInt(l.down) || 0) > 0)).length}台设备限速中`),
            ]),
            _diagSection('🔌 连接方式与拓扑', [
                _diagItem('连接方式分布', deviceList.length > 0 ? '✓' : '⚠',
                    deviceList.length > 0 ? `无线 ${wifiN} 台 · 有线 ${wiredN} 台 · 未知 ${unknownN} 台（未知=接入设备列表未上报）` : '暂无在线设备'),
                _diagItem('网络接口', ifaces.length > 0 ? '✓' : '⚠', ifaces.length > 0 ? ifaces.join(' ') : '未能枚举 /sys/class/net'),
                _diagItem('有线统计说明', '✓', '统计不区分有线/无线，转发流量均计数；有线口下接路由器/电脑时只能看到该设备本身，其 NAT 后设备的流量并入它统计（拓扑决定，非统计遗漏）'),
            ]),
            _diagSection('💾 数据持久化', [
                _diagItem('文件读写', persistStatus, persistDetail),
                _diagItem('名称文件', namesExist ? '✓' : '⚠', `${fmtBytes(namesSize)}${namesExist ? '' : ' · 未创建'}`),
                _diagItem('流量文件', historyExist ? '✓' : '⚠', `${fmtBytes(historySize)}${historyExist ? '' : ' · 未创建'}`),
                _diagItem('归档文件', snapsExist ? '✓' : '⚠', `${fmtBytes(snapsSize)} · ${snapshots.length}条快照${snapsExist ? '' : ' · 未创建'}`),
                _diagItem('限速配置', limitsExist ? '✓' : '⚠', `${fmtBytes(limitsSize)}${limitsExist ? '' : ' · 未创建'}`),
            ]),
            _diagSection('📋 自动归档', [
                _diagItem('定时器', archiveStatus, archiveDetail),
            ]),
            _diagSection('🔘 功能按钮状态', btnItems),
        ];

        const persistOk = writeTest || namesExist || historyExist;
        const summary = chainExists && persistOk
            ? '<span style="color:#4ade80;font-weight:bold;">✓ 系统正常运行</span>'
            : chainExists
                ? '<span style="color:#fbbf24;font-weight:bold;">⚠ 流量统计正常 · 文件存储待确认</span>'
                : '<span style="color:#f87171;font-weight:bold;">❌ 流量统计异常 · 请检查权限</span>';

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) {
            contentEl.style.display = 'block';
            contentEl.innerHTML = `
                <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin-bottom:12px;text-align:center;font-size:13px;">
                    ${summary}<br>
                    <span style="font-size:10px;opacity:.5;">v21.0.2 · ${new Date().toLocaleString()}</span>
                </div>
                ${auditHtml}
                ${sections.join('')}
                <div style="margin-top:12px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:10px;opacity:.5;text-align:center;">
                    截图保存或发送给开发者 · 数据目录: ${NAMES_FILE.replace(/\/[^\/]+$/, '/')}<br>
                    <div style="display:flex;gap:8px;justify-content:center;margin-top:6px;">
                        <button id="kano_diag_export_log" style="font-size:11px;padding:4px 12px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);border-radius:4px;color:#38bdf8;cursor:pointer;">📋 导出运行日志</button>
                        <button id="kano_diag_export_pack" style="font-size:11px;padding:4px 12px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);border-radius:4px;color:#4ade80;cursor:pointer;">📦 一键导出诊断包</button>
                    </div>
                </div>
            `;
            // v20: 诊断弹窗内导出日志；v20.1.3(I2): 诊断包入口放在诊断弹窗底部
            setTimeout(() => {
                el.querySelector('#kano_diag_export_log')?.addEventListener('click', () => {
                    showLogModal();
                });
                el.querySelector('#kano_diag_export_pack')?.addEventListener('click', () => {
                    showExportModal();
                });
            }, 50);
        }
    };
// ============================================================
    //  交互
    // ============================================================

    // 「刷新」= 完整流程（initChain + fetchDevs + syncRules + updateStats + 渲染 + 强制落盘）
    let _refreshing = false; // v20.0.1(F7): 重入保护，避免监控自启与手动/面板刷新并发双跑
    const refresh = async () => {
        if (pluginUninstalled || _refreshing || _tickRunning) return; // v20.3.0(M4): 与监控 tick 互斥，台账读写同一口径
        _refreshing = true;
        const btn = document.querySelector('#kano_traffic_refresh_btn');
        if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
        try {
            await initChain();
            if (hasIp6tables && enableIPv6) await initChain6();
            await fetchDevs();
            await syncRules();
            await applyLimits(); // v19.10.0: 限速规则随完整同步重建
            await updateStats();
            renderList();
            renderOverview();
            await flushHistory(true); // B8: 手动刷新结束强制落盘
        } catch (e) {
            console.error('[设备流量监控] 刷新失败:', e);
            _log('ERR', `手动刷新失败: ${e && e.message || e}`); // v20.4.0(N5)
            createToast('刷新失败', 'red', 3000);
        } finally {
            _refreshing = false;
            if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
        }
    };

    // 性能：tick 默认只做 updateStats+渲染（2次shell）；约每 30s 完整 fetchDevs+syncRules
    // v20.2.0(L2): 完整同步 tick 数按当前刷新间隔折算，间隔改了 30s 节奏不变
    let _tickRunning = false; // v20.3.0(M4): tick 重入保护 —— shell 慢时上一个 tick 未跑完就跳过本次，
    let _lastProbe = 0;       // v20.4.0(N2): 新设备探针上次探测时间(节流>=2s)
    // 否则两个并发 updateStats 交错读写 addrUp 台账，"计数器变小补计"会被触发两次 → 流量重复累加
    const monitorTick = async () => {
        if (pluginUninstalled || _tickRunning || _refreshing) return;
        _tickRunning = true;
        monitorTickCount++;
        try {
            const fullSyncEvery = Math.max(1, Math.round(FULL_SYNC_MS / getRefreshInterval()));
            // v20.3.0(M6): 新设备轻量探针 —— 非完整同步轮只读 /proc/net/arp(1次轻shell)，发现陌生 MAC
            // 当轮立即完整同步建规则，新设备"最长30s无规则不计数"缩短到一次探测间隔内
            // v20.4.0(N2): 探针按时间节流(>=2s一次) —— 刷新间隔调到 0.5s 时不会每 tick 多打一次 shell
            if (monitorTickCount < fullSyncEvery && Date.now() - _lastProbe >= 2000) {
                _lastProbe = Date.now();
                try {
                    const arpNow = await getArpDevs();
                    const known = new Set(deviceList.map(d => d.mac));
                    if (arpNow.some(a => !known.has(a.mac))) {
                        _log('SYNC', '探针发现新设备接入，当轮立即完整同步');
                        await initChain();
                        if (hasIp6tables && enableIPv6) await initChain6();
                        await fetchDevs();
                        await syncRules();
                        await applyLimits();
                        monitorTickCount = 0;
                    }
                } catch (e) {}
            }
            if (monitorTickCount >= fullSyncEvery) {
                monitorTickCount = 0;
                await initChain();
                if (hasIp6tables && enableIPv6) await initChain6();
                await fetchDevs();
                await syncRules();
                await applyLimits(); // v19.10.0: 每 30s 完整同步时重建限速规则
            }
            await updateStats();
            renderList();
            renderOverview();
        } catch (e) {
            console.error('[设备流量监控] 监控tick异常:', e);
            _log('ERR', `监控tick异常: ${e && e.message || e}`); // v20.4.0(N5): 异常落盘，事后可查
        } finally {
            _tickRunning = false; // v20.3.0(M4)
        }
    };

    const clearAllTraffic = async () => {
        if (pluginUninstalled) return;
        // v20.3.0(M1): 弱口令检查已移除，由按钮连点2次确认防呆
        // v20.4.0(N3): 与 tick/refresh 互斥 —— 清链+重建期间 tick 读到半空状态会触发台账误补计
        if (_refreshing || _tickRunning) { createToast('正在同步数据，请稍后再试', 'pink', 3000); return; }
        _refreshing = true;
        try {
        await flushChain();
        await initChain();
        if (hasIp6tables && enableIPv6) await flushChain6();
        if (hasIp6tables && enableIPv6) await initChain6();
        ruleOwners = {}; // 链已清空，规则台账重置后由 syncRules 批量重建
        await syncRules();
        await readEngineJson(true); // v21.0.0(P3): 重计前刷新引擎读数作为基线，基线之后流量不丢不重
        const now = Date.now();
        resetHistoryEntries(now, true);
        await flushHistory(true); // B8: 清除全部流量强制落盘
        renderList();
        renderOverview();
        _log('ACTION', '清除全部流量(保留名称)'); // v20.1.0(G5)
        createToast('已清除全部流量，自定义名称已保留', 'green');
        } finally { _refreshing = false; } // v20.4.0(N3)
    };

    // v20.2.0(L1): 「清零统计」与「清除全部流量」功能重复，已删除 resetStats（保留确认步骤更少的 clearAllTraffic）
    // ============================================================
    //  归档快照
    // ============================================================

    const archiveAndReset = async (label, resetCounters = true) => {
        if (pluginUninstalled) return;
        // v20.4.0(N3): 与监控 tick/手动刷新互斥 —— 否则 tick 可能在"已归档快照、尚未清零"的窗口内
        // 把旧计数再写回 history(双重计入快照+当前)，或在清零中途读到半清零状态触发误补计
        if (_refreshing || _tickRunning) { createToast('正在同步数据，请稍后再试', 'pink', 3000); return; }
        _refreshing = true;
        try {
        await updateStats(); // v20.4.0(N3): 归档前先把链上最新计数并入 history —— 快照与清零之间不再有空窗丢量
        const now = Date.now();
        // v20.4.0(N4): snap.reset 标记是否"重计归档" —— 累计排行只叠加 reset 归档，修复"仅归档"与
        // 当前统计口径重叠导致的累计排行双倍计数(含旧地址已归档流量的重复累加观感)
        const snap = { id: now, label: label || '归档 ' + fmtDateTime(now), time: now, reset: !!resetCounters, by: clientName, devices: {} }; // v21.0.2(R1): by=上传端标识
        const allMacs = new Set([...deviceList.map(d => d.mac), ...Object.keys(trafficHistory)]);
        for (const mac of allMacs) {
            const t = getTraffic(mac);
            const name = customNames[mac] || (trafficHistory[mac]?.hostname) || defaultDeviceName(trafficHistory[mac]?.ip);
            if (t.total > 0) {
                 snap.devices[mac] = { up: t.up, down: t.down, total: t.total, name, ip: trafficHistory[mac]?.ip || '', ip6: trafficHistory[mac]?.ip6s?.[0] || trafficHistory[mac]?.ip6 || '' };
            }
        }
        snapshots.unshift(snap);
        if (snapshots.length > 50) snapshots = snapshots.slice(0, 50);
        await saveSnapshots();
        _log('ACTION', `归档 ${snap.label} reset=${resetCounters} 设备数=${Object.keys(snap.devices).length} 总量=${formatBytes(Object.values(snap.devices).reduce((s, d) => s + d.total, 0))}`); // v20.1.0(G5)

        if (resetCounters) {
            await _cleanMounts();
            await zeroChainCounters();
            if (hasIp6tables && enableIPv6) {
                await flushChain6();
                await initChain6();
                for (const k of Object.keys(ruleOwners)) if (_isV6Addr(k)) delete ruleOwners[k];
            }
            await initChain();
            await fetchDevs();
            await syncRules();
            await readEngineJson(true); // v21.0.0(P3): 重计前刷新引擎读数作为基线
            resetHistoryEntries(now, false);
            lastUpdateTime = Date.now();
            await flushHistory(true); // B8: 归档强制落盘
            renderList();
            renderOverview();
            createToast('已归档并重计: ' + snap.label, 'green');
        } else {
            await flushHistory(true); // B8: 仅归档也强制落盘
            renderList();
            renderOverview();
            createToast('已归档: ' + snap.label, 'green');
        }
        } finally { _refreshing = false; } // v20.4.0(N3)
    };

    const fmtDateTime = (ts) => {
        const d = new Date(ts);
        return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    };

    const showHistoryModal = () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_history_modal', title: '&#x1F4CB; 历史流量归档', maxWidth: 'min(480px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div id="kano_history_content" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;"></div>`
        });
        showModal(id);
        renderHistoryContent(el.querySelector('#kano_history_content'));
    };

    let selectedSnaps = new Set();
    let historyByFilter = ''; // v21.0.2(R2): 历史按上传者筛选(''=全部)

    const renderHistoryContent = (container) => {
        if (pluginUninstalled) return;
        if (!container) return;
        if (snapshots.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;opacity:.5;">暂无归档记录<br><br>点击「归档并重计」创建第一条记录</div>';
            return;
        }
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
        html += '<div style="opacity:.6;font-size:11px;">共 ' + snapshots.length + ' 条（最多50条）</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        // v21.0.2(R2): 上传者筛选下拉(仅当存在带上传者标记的记录时显示)
        const bySet = [...new Set(snapshots.map(s => s.by).filter(Boolean))];
        if (historyByFilter && !bySet.includes(historyByFilter)) historyByFilter = ''; // 该上传者记录已删光 → 回全部
        if (bySet.length > 0) {
            html += '<select id="kano_hist_by" style="font-size:10px;padding:3px 6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:inherit;max-width:110px;"><option value="">全部上传者</option>' +
                bySet.map(b => `<option value="${escHtml(b)}" ${historyByFilter === b ? 'selected' : ''}>${escHtml(b)}</option>`).join('') + '</select>';
        }
        html += '<button id="kano_snap_selectall" style="font-size:10px;padding:3px 8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:inherit;cursor:pointer;">全选</button>';
        html += '<button id="kano_snap_readd" style="font-size:10px;padding:3px 8px;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:4px;color:#4ade80;cursor:pointer;">&#x21A9;&#xFE0F; 回添选中</button>';
        html += '<button id="kano_snap_batchdel" style="font-size:10px;padding:3px 8px;background:rgba(255,107,107,0.12);border:1px solid rgba(255,107,107,0.2);border-radius:4px;color:#ff6b6b;cursor:pointer;">删除选中</button>';
        html += '</div></div>';

        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        const idxList = []; // v21.0.2(R2): 按上传者筛选后的真实下标集合(勾选/删除仍用原下标)
        for (let i = 0; i < snapshots.length; i++) if (!historyByFilter || snapshots[i].by === historyByFilter) idxList.push(i);
        if (idxList.length === 0) html += '<div style="text-align:center;padding:20px;opacity:.5;">该上传者暂无记录</div>';
        for (const idx of idxList) {
            const snap = snapshots[idx];
            const devCount = Object.keys(snap.devices).length;
            let totalAll = 0;
            for (const d of Object.values(snap.devices)) totalAll += d.total;
            const checked = selectedSnaps.has(idx) ? 'checked' : '';
            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" class="snap-checkbox" data-idx="${idx}" ${checked} style="width:16px;height:16px;flex-shrink:0;">
                        <div style="flex:1;cursor:pointer;" onclick="this.parentElement.parentElement.querySelector('.snap-detail').style.display=this.parentElement.parentElement.querySelector('.snap-detail').style.display==='none'?'block':'none';">
                            <div style="font-weight:700;color:var(--dark-btn-color-active);font-size:12px;">${escHtml(snap.label)}${snap.reset === false ? '<span style="font-size:9px;font-weight:400;color:#fbbf24;border:1px solid rgba(251,191,36,.3);border-radius:3px;padding:0 4px;margin-left:6px;">仅归档</span>' : ''}</div><!-- v20.4.0(N4): 区分仅归档/重计归档 -->
                            <div style="opacity:.5;font-size:10px;margin-top:2px;">${fmtDateTime(snap.time)} &#xB7; ${devCount} 个设备 &#xB7; 总 ${formatBytes(totalAll)}${snap.by ? ' &#xB7; 由 ' + escHtml(snap.by) + ' 上传' : ''}</div><!-- v21.0.4(R2): 显示上传端 -->
                        </div>
                        <span style="font-size:10px;opacity:.4;flex-shrink:0;">&#x25BC;</span>
                    </div>
                    <div class="snap-detail" style="display:none;padding-top:8px;padding-left:24px;">
                        <table style="width:100%;font-size:11px;border-collapse:collapse;">
                            <tr style="opacity:.5;font-size:10px;"><td>设备</td><td style="text-align:right;">上行</td><td style="text-align:right;">下行</td><td style="text-align:right;">总流量</td></tr>
                            ${Object.values(snap.devices).sort((a, b) => (b.total || 0) - (a.total || 0)).map(d => `<tr style="border-top:1px solid rgba(255,255,255,0.04);"><td style="padding:4px 0;">${escHtml(d.name)}</td><td style="text-align:right;font-family:monospace;">${formatBytes(d.up)}</td><td style="text-align:right;font-family:monospace;">${formatBytes(d.down)}</td><td style="text-align:right;font-weight:700;">${formatBytes(d.total)}</td></tr>`).join('')}<!-- v20.4.0(N1): 设备按总流量降序 -->
                        </table>
                    </div>
                </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        // v21.0.2(R2): 上传者筛选切换
        container.querySelector('#kano_hist_by')?.addEventListener('change', (e) => {
            historyByFilter = e.target.value;
            renderHistoryContent(container);
        });

        container.querySelectorAll('.snap-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const idx = parseInt(cb.dataset.idx);
                if (cb.checked) selectedSnaps.add(idx); else selectedSnaps.delete(idx);
            });
        });
        const selAllBtn = container.querySelector('#kano_snap_selectall');
        if (selAllBtn) selAllBtn.addEventListener('click', () => {
            const allChecked = selectedSnaps.size === snapshots.length;
            selectedSnaps.clear();
            if (!allChecked) { for (let i = 0; i < snapshots.length; i++) selectedSnaps.add(i); }
            renderHistoryContent(container);
        });
        // v20.2.0(L4): 回添选中 —— 把勾选归档里的设备流量反向加回"正在统计"的累计中，并移除这些归档
        const readdBtn = container.querySelector('#kano_snap_readd');
        if (readdBtn) readdBtn.addEventListener('click', async () => {
            if (selectedSnaps.size === 0) { createToast('请先勾选要回添的记录', 'pink'); return; }
            const { id, el: reEl } = createModal({
                name: 'snap_readd_modal', title: '回添归档到当前统计', maxWidth: 'min(340px, 94vw)',
                showConfirm: true, confirmBtnText: '确认回添', closeBtnText: '取消',
                onClose: () => true,
                onConfirm: async () => {
                    const idxs = Array.from(selectedSnaps).sort((a, b) => b - a);
                    const now = Date.now();
                    let mergedDevs = 0, mergedBytes = 0;
                    for (const idx of idxs) {
                        const snap = snapshots[idx];
                        if (!snap) continue;
                        for (const [mac, sd] of Object.entries(snap.devices || {})) {
                            const h = trafficHistory[mac] || {
                                totalUp: 0, totalDown: 0, curUp: 0, curDown: 0, lastUp: 0, lastDown: 0,
                                firstSeen: snap.time || now, hostname: '', ip: '', ip6s: [], ip6: null,
                                addrUp: {}, addrDown: {}, speedUp: 0, speedDown: 0
                            };
                            h.totalUp = (h.totalUp || 0) + (sd.up || 0);
                            h.totalDown = (h.totalDown || 0) + (sd.down || 0);
                            if (!h.hostname && sd.name) h.hostname = sd.name;
                            if (!h.ip && sd.ip) h.ip = sd.ip;
                            if ((!h.ip6s || !h.ip6s.length) && sd.ip6) { h.ip6s = [sd.ip6]; h.ip6 = h.ip6 || sd.ip6; }
                            h.lastSeen = now;
                            trafficHistory[mac] = h;
                            mergedDevs++;
                            mergedBytes += (sd.up || 0) + (sd.down || 0);
                        }
                        snapshots.splice(idx, 1);
                    }
                    selectedSnaps.clear();
                    historyDirty = true;
                    await flushHistory(true);
                    await saveSnapshots();
                    renderList();
                    renderOverview();
                    renderHistoryContent(container);
                    _log('ACTION', `回添归档到当前统计 条数=${idxs.length} 设备=${mergedDevs} 流量=${formatBytes(mergedBytes)}`);
                    createToast(`已回添 ${idxs.length} 条归档(${mergedDevs}台设备 ${formatBytes(mergedBytes)})到当前统计`, 'green', 5000);
                    return true;
                },
                content: `<div style="font-size:13px;opacity:.85;">确定将 <strong>${selectedSnaps.size}</strong> 条归档记录的流量<strong style="color:#4ade80;">加回正在统计的累计中</strong>？<br><br>
                    <span style="font-size:12px;opacity:.7;">归档中的每台设备流量将累加到当前统计；回添后这些归档会被移除（避免累计排行重复计数）。</span><br><br>
                    <span style="color:#fbbf24;font-size:12px;">此操作不可自动撤销，请确认这些流量尚未计入当前统计。</span></div>`
            });
            showModal(id);
        });
        const batchDelBtn = container.querySelector('#kano_snap_batchdel');
        if (batchDelBtn) batchDelBtn.addEventListener('click', async () => {
            if (selectedSnaps.size === 0) { createToast('请先勾选要删除的记录', 'pink'); return; }
            const { id, el: delEl } = createModal({
                name: 'snap_batchdel_modal', title: '批量删除归档', maxWidth: 'min(320px, 94vw)',
                showConfirm: true, confirmBtnText: '确认删除', closeBtnText: '取消',
                onClose: () => true,
                onConfirm: async () => {
                    const toDelete = Array.from(selectedSnaps).sort((a, b) => b - a);
                    for (const idx of toDelete) snapshots.splice(idx, 1);
                    selectedSnaps.clear();
                    await saveSnapshots();
                    renderHistoryContent(container);
                    createToast('已删除 ' + toDelete.length + ' 条归档', 'green');
                    return true;
                },
                content: `<div style="font-size:13px;opacity:.85;">确定删除 <strong>${selectedSnaps.size}</strong> 条归档记录？<br><br><span style="color:#ff6b6b;font-size:12px;">此操作不可恢复。</span></div>`
            });
            showModal(id);
        });
    };
    // ============================================================
    //  流量排行
    // ============================================================

    const getCumulativeTraffic = (mac) => {
        const cur = getTraffic(mac);
        let snapUp = 0, snapDown = 0;
        // v20.4.0(N4): 只叠加"归档并重计"(reset!==false)的快照 —— "仅归档"快照与当前统计口径重叠，
        // 一并叠加会把同一段流量算两遍(旧地址已归档流量重复累加的观感来源)；旧快照无 reset 字段按重计归档处理
        for (const snap of snapshots) {
            if (snap.reset === false) continue;
            const d = snap.devices[mac];
            if (d) { snapUp += d.up || 0; snapDown += d.down || 0; }
        }
        return { up: cur.up + snapUp, down: cur.down + snapDown, total: cur.total + snapUp + snapDown };
    };

    let rankMode = 'current';

    const renderRankTable = (container) => {
        if (pluginUninstalled) return;
        if (!container) return;
        const isCumulative = rankMode === 'cumulative';
        const allDevs = [];
        const seenMacs = new Set();
        for (const d of deviceList) {
            const t = isCumulative ? getCumulativeTraffic(d.mac) : getTraffic(d.mac);
            if (t.total > 0) {
                allDevs.push({ name: d.hostname, mac: d.mac, ip: d.ip || '--', online: true, ...t });
                seenMacs.add(d.mac);
            }
        }
        for (const [mac, h] of Object.entries(trafficHistory)) {
            if (seenMacs.has(mac)) continue;
            const t = isCumulative ? getCumulativeTraffic(mac) : getTraffic(mac);
            if (t.total > 0) {
                allDevs.push({
                    name: customNames[mac] || h.hostname || defaultDeviceName(h.ip),
                    mac, ip: h.ip || '--', online: false, ...t
                });
            }
        }
        if (isCumulative) {
            for (const snap of snapshots) {
                for (const [mac, sd] of Object.entries(snap.devices)) {
                    if (seenMacs.has(mac)) continue;
                    const t = getCumulativeTraffic(mac);
                    if (t.total > 0) {
                        allDevs.push({
                            name: sd.name || customNames[mac] || defaultDeviceName(sd.ip),
                            mac, ip: sd.ip || '--', online: false, ...t
                        });
                        seenMacs.add(mac);
                    }
                }
            }
        }
        allDevs.sort((a, b) => b.total - a.total);
        let grand = allDevs.reduce((s, d) => s + d.total, 0);
        const rankColors = ['#fbbf24', '#9ca3af', '#b45309'];
        const rankIcons = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];

        let rows = '';
        for (let i = 0; i < allDevs.length; i++) {
            const d = allDevs[i];
            const pct = grand > 0 ? ((d.total / grand) * 100).toFixed(1) : 0;
            const color = i < 3 ? rankColors[i] : 'inherit';
            const icon = i < 3 ? rankIcons[i] : (i + 1);
            rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                <td style="padding:8px 4px;font-weight:900;color:${color};font-size:14px;text-align:center;width:30px;">${icon}</td>
                <td style="padding:8px 4px;">
                    <div style="font-weight:700;font-size:13px;">${escHtml(d.name)}${d.online ? ' <span style="color:#4ade80;font-size:9px;">&#x25CF;</span>' : ' <span style="opacity:.3;font-size:9px;">&#x25CB;</span>'}</div>
                    <div style="font-size:10px;opacity:.5;">${d.ip}</div>
                </td>
                <td style="padding:8px 4px;text-align:right;font-family:monospace;font-size:12px;color:#4ade80;">${formatBytes(d.up)}</td>
                <td style="padding:8px 4px;text-align:right;font-family:monospace;font-size:12px;color:#60a5fa;">${formatBytes(d.down)}</td>
                <td style="padding:8px 4px;text-align:right;font-size:13px;font-weight:800;color:var(--dark-btn-color-active);">${formatBytes(d.total)}</td>
                <td style="padding:8px 4px;text-align:right;width:80px;">
                    <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div style="width:${Math.min(pct, 100)}%;height:100%;background:linear-gradient(90deg,${i < 3 ? color : 'var(--dark-btn-color-active)'},#4ade80);border-radius:2px;"></div></div>
                    <div style="font-size:9px;opacity:.4;text-align:right;margin-top:2px;">${pct}%</div>
                </td>
            </tr>`;
        }

        container.innerHTML = `
            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <button id="rank_btn_current" style="flex:1;padding:6px;border-radius:6px;border:1px solid ${!isCumulative ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${!isCumulative ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;font-size:12px;cursor:pointer;font-weight:${!isCumulative ? '700' : '400'};">&#x1F4CA; 当前流量</button>
                <button id="rank_btn_cumulative" style="flex:1;padding:6px;border-radius:6px;border:1px solid ${isCumulative ? 'var(--dark-btn-color-active)' : 'rgba(255,255,255,0.1)'};background:${isCumulative ? 'rgba(255,255,255,0.08)' : 'transparent'};color:inherit;font-size:12px;cursor:pointer;font-weight:${isCumulative ? '700' : '400'};">&#x1F4C8; 累计流量</button>
            </div>
            <div style="font-size:12px;margin-bottom:8px;opacity:.6;">${isCumulative ? '当前 + 历次「归档并重计」(不含「仅归档」，避免重复计数)' : '本次归档/重置以来'} &#xB7; 共 ${allDevs.length} 个设备 &#xB7; 总 ${formatBytes(grand)}</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse;">
                <tr style="font-size:10px;opacity:.5;border-bottom:2px solid rgba(255,255,255,0.08);"><td></td><td>设备</td><td style="text-align:right;">&#x2B06;&#xFE0F;</td><td style="text-align:right;">&#x2B07;&#xFE0F;</td><td style="text-align:right;">总流量</td><td style="text-align:right;">占比</td></tr>
                ${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:.5;">暂无流量数据</td></tr>'}
            </table>`;

        const curBtn = container.querySelector('#rank_btn_current');
        const cumBtn = container.querySelector('#rank_btn_cumulative');
        if (curBtn) curBtn.addEventListener('click', () => { rankMode = 'current'; renderRankTable(container); });
        if (cumBtn) cumBtn.addEventListener('click', () => { rankMode = 'cumulative'; renderRankTable(container); });
    };

    const showRankModal = () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_rank_modal', title: '&#x1F3C6; 流量排行', maxWidth: 'min(480px, 94vw)',
            showConfirm: false, onClose: () => true,
            content: `<div id="kano_rank_content" style="font-size:12px;line-height:1.5;max-height:420px;overflow:auto;"></div>`
        });
        showModal(id);
        renderRankTable(el.querySelector('#kano_rank_content'));
    };

    const deleteDataFiles = async () => {
        // v20.3.0(M1): 弱口令检查已移除，删除数据由设置页主动勾选确认防呆
        await _shUser(`rm -f ${STORAGE_FILE} ${NAMES_FILE} ${SNAPSHOTS_FILE} ${LIMITS_FILE} ${STORAGE_FILE}.bak ${NAMES_FILE}.bak ${SNAPSHOTS_FILE}.bak ${LIMITS_FILE}.bak`);
        trafficHistory = {};
        customNames = {};
        deviceLimits = {};
        historyDirty = false;
        await applyLimits(); // v19.10.0: 限速配置已清空，摘除限速链挂载并删链
        renderList();
        renderOverview();
        createToast('数据文件已删除', 'green');
    };
    // ============================================================
    //  可配置自动归档时间
    // ============================================================

    const SETTINGS_KEY = 'kano_traffic_settings';
    let archiveSettings = { dailyEnabled: true, dailyHour: 0, dailyMinute: 0, monthlyEnabled: true, monthlyDay: 1, monthlyHour: 0, resetAfterArchive: true, logRetentionDays: 7, refreshSeconds: DEFAULT_REFRESH_SEC };

    let ipv6Settings = { enabled: false };
    const IPV6_SETTINGS_KEY = 'kano_traffic_ipv6_settings';
    const loadIPv6Settings = () => {
        try {
            const s = JSON.parse(localStorage.getItem(IPV6_SETTINGS_KEY) || '{}');
            if (s.enabled !== undefined) ipv6Settings = { ...ipv6Settings, ...s };
        } catch (e) {}
        enableIPv6 = ipv6Settings.enabled;
    };
    const saveIPv6Settings = () => {
        ipv6Settings.enabled = enableIPv6;
        localStorage.setItem(IPV6_SETTINGS_KEY, JSON.stringify(ipv6Settings));
    };

    const loadSettings = () => {
        loadIPv6Settings();
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            if (s.dailyHour !== undefined) archiveSettings = { ...archiveSettings, ...s };
        } catch (e) {}
    };
    const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(archiveSettings));

    let autoArchiveTimer = null;
    let lastAutoArchiveDay = localStorage.getItem('kano_last_auto_archive_day') || '';
    let lastAutoArchiveMonth = localStorage.getItem('kano_last_auto_archive_month') || '';

    // v21.0.2(R1): 心跳 —— 每 20s 刷新本端心跳文件(mtime 即存活证明)
    const beatHeartbeat = async () => {
        if (pluginUninstalled) return;
        try { await _shUser(`date +%s > ${HB_PREFIX}${CLIENT_ID} 2>/dev/null || true`); } catch (e) {}
    };
    let heartbeatTimer = null;
    const startHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        beatHeartbeat();
        heartbeatTimer = setInterval(beatHeartbeat, 20000);
    };

    // 选主: 清理 90s 以上的陈旧心跳, 存活端中 id 最小者为主端(各端结论一致, 无需锁)
    const isHeartbeatLeader = async () => {
        try {
            const r = await _shUser(`now=$(date +%s); for f in ${HB_PREFIX}*; do [ -f "$f" ] || continue; mt=$(stat -c %Y "$f" 2>/dev/null || echo 0); if [ $((now - mt)) -gt 90 ]; then rm -f "$f"; else echo "\${f##*/}"; fi; done | sort | head -1`);
            return _sh(r).trim() === `traffic_hb.${CLIENT_ID}`;
        } catch (e) { return true; } // 检测失败时默认为自己, 保证归档不丢
    };
    // 同名标签 6h 内已存在 → 其他端刚归档过, 跳过(双保险, 覆盖选主竞态与同id多标签页)
    const hasRecentSnapshot = (label) => snapshots.some(sn => sn && sn.label === label && Math.abs(Date.now() - (sn.time || 0)) < 6 * 3600 * 1000);

    const checkAutoArchive = async () => {
        if (pluginUninstalled) return;
        const now = new Date();
        const dayKey = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();
        const monthKey = now.getFullYear() + '-' + (now.getMonth()+1);

        // v20.1.0(G3): 每日顺手清理过期日志
        if (localStorage.getItem('kano_last_log_clean_day') !== dayKey) {
            localStorage.setItem('kano_last_log_clean_day', dayKey);
            cleanOldLogs();
        }

        // v21.0.2(R1): 到点判定先行, 不到点直接返回(不多打 shell); 到点则仅心跳主端执行归档
        const monthlyDue = archiveSettings.monthlyEnabled && now.getDate() === archiveSettings.monthlyDay && lastAutoArchiveMonth !== monthKey && now.getHours() === archiveSettings.monthlyHour;
        const dailyDue = archiveSettings.dailyEnabled && lastAutoArchiveDay !== dayKey && now.getHours() === archiveSettings.dailyHour && now.getMinutes() >= archiveSettings.dailyMinute;
        if (!monthlyDue && !dailyDue) return;
        if (!(await isHeartbeatLeader())) { _log('SYNC', '自动归档: 本端非心跳主端, 由主端执行'); return; }
        // 归档前重读共享快照文件做同名标签去重 —— 双保险覆盖选主竞态/同id多标签页
        const freshSnaps = await loadFromFile(SNAPSHOTS_FILE);
        if (freshSnaps) snapshots = freshSnaps;

        if (monthlyDue) {
            const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
            const prevMonthName = prevMonth + '月';
            const label = prevMonthName + '月报';
            if (hasRecentSnapshot(label)) {
                _log('SYNC', `自动归档: ${label} 他端已归档, 跳过`);
                lastAutoArchiveMonth = monthKey;
                localStorage.setItem('kano_last_auto_archive_month', monthKey);
                lastAutoArchiveDay = dayKey;
                localStorage.setItem('kano_last_auto_archive_day', dayKey);
                return;
            }
            await archiveAndReset(label, archiveSettings.resetAfterArchive !== false);
            lastAutoArchiveMonth = monthKey;
            localStorage.setItem('kano_last_auto_archive_month', monthKey);
            // B11: 月归档触发当天同时写 lastAutoArchiveDay，避免同日双归档
            lastAutoArchiveDay = dayKey;
            localStorage.setItem('kano_last_auto_archive_day', dayKey);
            createToast('&#x1F4C5; 已自动归档' + prevMonthName + '月报' + (archiveSettings.resetAfterArchive !== false ? '并重计' : ''), 'green');
            return;
        }

        if (dailyDue) {
            const yesterday = new Date(now - 86400000);
            const label = (yesterday.getMonth()+1) + '/' + yesterday.getDate() + ' 日报';
            if (hasRecentSnapshot(label)) {
                _log('SYNC', `自动归档: ${label} 他端已归档, 跳过`);
                lastAutoArchiveDay = dayKey;
                localStorage.setItem('kano_last_auto_archive_day', dayKey);
                return;
            }
            await archiveAndReset(label, archiveSettings.resetAfterArchive !== false);
            lastAutoArchiveDay = dayKey;
            localStorage.setItem('kano_last_auto_archive_day', dayKey);
            createToast('&#x1F4C5; 已自动归档 ' + label + (archiveSettings.resetAfterArchive !== false ? '并重计' : ''), 'green');
        }
    };

    const startAutoArchive = () => {
        if (autoArchiveTimer) clearInterval(autoArchiveTimer);
        autoArchiveTimer = setInterval(() => checkAutoArchive(), 300000);
    };

    const stopAutoArchive = () => {
        if (autoArchiveTimer) { clearInterval(autoArchiveTimer); autoArchiveTimer = null; }
    };

    // ============================================================
    //  设置弹窗
    // ============================================================

    const showSettingsModal = () => {
        if (pluginUninstalled) return;
        loadSettings();
        const pad = (n) => String(n).padStart(2, '0');
        const hours = Array.from({length:24}, (_,i) => `<option value="${i}" ${archiveSettings.dailyHour===i?'selected':''}>${pad(i)}:00</option>`).join('');
        const hours2 = Array.from({length:24}, (_,i) => `<option value="${i}" ${archiveSettings.monthlyHour===i?'selected':''}>${pad(i)}:00</option>`).join('');
        const days = Array.from({length:28}, (_,i) => `<option value="${i+1}" ${archiveSettings.monthlyDay===i+1?'selected':''}>${i+1}日</option>`).join('');
        const minutes = Array.from({length:60}, (_,i) => `<option value="${i}" ${archiveSettings.dailyMinute===i?'selected':''}>${pad(i)}分</option>`).join('');

        const { id, el } = createModal({
            name: 'traffic_settings_modal', title: '&#x2699;&#xFE0F; 设置', maxWidth: 'min(400px, 94vw)',
            showConfirm: true, confirmBtnText: '保存设置', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => {
                const dailyEn = el.querySelector('#set_daily_en')?.checked ?? true;
                const dailyH = parseInt(el.querySelector('#set_daily_h')?.value || '0');
                const dailyM = parseInt(el.querySelector('#set_daily_m')?.value || '0');
                const monthlyEn = el.querySelector('#set_monthly_en')?.checked ?? true;
                const monthlyD = parseInt(el.querySelector('#set_monthly_d')?.value || '1');
                const monthlyH = parseInt(el.querySelector('#set_monthly_h')?.value || '0');
                const resetAfter = el.querySelector('#set_reset_after')?.checked ?? true;
                const logDaysRaw = parseInt(el.querySelector('#set_log_days')?.value); // v20.1.0(G3)
                const logRetentionDays = isNaN(logDaysRaw) ? 7 : Math.min(90, Math.max(0, logDaysRaw));
                const refreshSecRaw = parseFloat(el.querySelector('#set_refresh_sec')?.value); // v20.2.0(L2) / v20.4.0(N2): 0.5~5s 小数
                const refreshSeconds = isNaN(refreshSecRaw) ? DEFAULT_REFRESH_SEC : Math.min(5, Math.max(0.5, refreshSecRaw));
                // v21.0.2(R1/R2): 本机标识(心跳+归档上传者标记)
                const cnRaw = (el.querySelector('#set_client_name')?.value || '').trim();
                if (cnRaw && cnRaw !== clientName) {
                    clientName = cnRaw.slice(0, 16);
                    localStorage.setItem('kano_traffic_client_name', clientName);
                    _log('ACTION', `本机标识已修改为 ${clientName}`);
                }
                archiveSettings = { dailyEnabled: dailyEn, dailyHour: dailyH, dailyMinute: dailyM, monthlyEnabled: monthlyEn, monthlyDay: monthlyD, monthlyHour: monthlyH, resetAfterArchive: resetAfter, logRetentionDays, refreshSeconds };
                saveSettings();
                // v20.2.0(L2): 自动监控运行中 → 立即按新间隔重启定时器，无需手动停开
                if (monitorTimer) {
                    monitorTimer();
                    monitorTimer = requestInterval(() => { monitorTick(); }, getRefreshInterval());
                    _log('ACTION', `刷新间隔已调整为 ${refreshSeconds}s(监控运行中,已即时生效)`);
                }
                const prevEnableIPv6 = enableIPv6;
                enableIPv6 = hasIp6tables ? (el.querySelector('#set_ipv6')?.checked ?? false) : false;
                saveIPv6Settings();
                // v20.4.0(N3): 设置变更(IPv6开关/删数据)期间屏蔽 tick，防止链半拆半建状态被 tick 读到误补计
                _refreshing = true;
                try {
                if (enableIPv6 && !prevEnableIPv6) {
                    // 开启：同步 init v6 链与规则
                    await initChain6();
                    await fetchDevs();
                    await syncRules();
                    await applyLimits(); // v19.10.0: 补建 v6 限速规则
                    await updateStats();
                    renderList();
                    createToast('IPv6监测已开启，已重新初始化规则', 'green');
                } else if (!enableIPv6 && prevEnableIPv6 && hasIp6tables) {
                    // 关闭：同步清理 v6 链与规则
                    await updateStats(); // v20.4.0(N6): 先并入 v6 最新计数，flushChain6 删规则不丢尾部流量
                    await _cleanMounts6();
                    await flushChain6();
                    for (const k of Object.keys(ruleOwners)) if (_isV6Addr(k)) delete ruleOwners[k];
                    for (const d of deviceList) d.ip6s = [];
                    await applyLimits(); // v19.10.0: 清理 v6 限速链（mountLimitChains 内 v6 关闭分支）
                    const c4 = await getCounters(false); // v20.4.0: getCounters 失败返回 null，取下标前必须判空
                    for (const d of deviceList) {
                        const h = trafficHistory[d.mac];
                        if (!h) continue;
                        const up = (c4 && d.ip && c4[d.ip]) ? c4[d.ip].up : 0;
                        const down = (c4 && d.ip && c4[d.ip]) ? c4[d.ip].down : 0;
                        h.lastUp = up; h.lastDown = down; h.curUp = up; h.curDown = down;
                    }
                    renderList();
                    createToast('IPv6监测已关闭，v6链与规则已清理', 'green');
                }
                const wantMobile = el.querySelector('#set_uimode')?.checked || false;
                if (wantMobile !== (uiMode === 'mobile')) toggleUiMode();
                if (el.querySelector('#set_deldata')?.checked) await deleteDataFiles();
                } finally { _refreshing = false; } // v20.4.0(N3)
                createToast('设置已保存', 'green');
                return true;
            },
            content: `
                <div style="font-size:13px;line-height:1.6;">
                    <div style="margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <input type="checkbox" id="set_daily_en" ${archiveSettings.dailyEnabled ? 'checked' : ''} style="width:16px;height:16px;">
                            <label for="set_daily_en" style="font-weight:bold;color:var(--dark-btn-color-active);">每日自动归档</label>
                        </div>
                        <div style="display:flex;gap:8px;padding-left:24px;opacity:.85;">
                            <select id="set_daily_h" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${hours}</select>
                            <select id="set_daily_m" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${minutes}</select>
                        </div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <input type="checkbox" id="set_monthly_en" ${archiveSettings.monthlyEnabled ? 'checked' : ''} style="width:16px;height:16px;">
                            <label for="set_monthly_en" style="font-weight:bold;color:#a78bfa;">每月自动归档</label>
                        </div>
                        <div style="display:flex;gap:8px;padding-left:24px;opacity:.85;">
                            <select id="set_monthly_d" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${days}</select>
                            <select id="set_monthly_h" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">${hours2}</select>
                        </div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <input type="checkbox" id="set_reset_after" ${archiveSettings.resetAfterArchive!==false?'checked':''} style="width:16px;height:16px;">
                            <label for="set_reset_after" style="font-weight:bold;color:#fb923c;">归档后重计流量</label>
                        </div>
                        <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">自动归档后清零计数器重新开始统计</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="font-weight:bold;color:#38bdf8;margin-bottom:6px;">本机标识</div>
                        <input type="text" id="set_client_name" value="${escHtml(clientName)}" maxlength="16" style="width:100%;box-sizing:border-box;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                        <div style="opacity:.5;font-size:11px;margin-top:3px;">v21.0.2: 多端同时打开插件时仅心跳主端执行自动归档(不再重复日报)；归档记录会带上该标识，历史里可按上传者筛选</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <input type="checkbox" id="set_ipv6" ${enableIPv6 ? 'checked' : ''} ${!hasIp6tables ? 'disabled' : ''} style="width:16px;height:16px;${!hasIp6tables ? 'opacity:.3' : ''}">
                            <label for="set_ipv6" style="font-weight:bold;color:#a78bfa;${!hasIp6tables ? 'opacity:.5' : ''}">监测 IPv6 流量</label>
                        </div>
                        <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">
                            ${hasIp6tables ? '启用后统计 IPv4 + IPv6 双栈流量（每台设备跟踪全部 IPv6 地址）' : '系统无 ip6tables，无法监测 IPv6'}
                        </div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <input type="checkbox" id="set_uimode" ${uiMode==='mobile'?'checked':''} style="width:16px;height:16px;">
                            <label for="set_uimode" style="font-weight:bold;color:#38bdf8;">手机视图</label>
                        </div>
                        <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">勾选=手机视图(隐藏MAC+信号列) &#xB7; 取消=桌面视图(显示全部)</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <label for="set_refresh_sec" style="font-weight:bold;color:#4ade80;">监控刷新间隔(秒)</label>
                            <input id="set_refresh_sec" type="number" min="0.5" max="5" step="0.5" value="${archiveSettings.refreshSeconds ?? DEFAULT_REFRESH_SEC}" style="width:70px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                        </div>
                        <div style="opacity:.5;font-size:11px;margin-top:3px;">自动监控的刷新频率(0.5~5秒,默认5秒,0.5步进)；间隔越小实时性越好但设备负载越高；保存后运行中的监控立即生效</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <label for="set_log_days" style="font-weight:bold;color:#38bdf8;">日志保留天数</label>
                            <input id="set_log_days" type="number" min="0" max="90" step="1" value="${archiveSettings.logRetentionDays ?? 7}" style="width:70px;padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:inherit;font-size:12px;">
                        </div>
                        <div style="opacity:.5;font-size:11px;margin-top:3px;">超过天数的日志自动删除；0 = 不按时长清理（始终另保留最近200条）</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" id="set_deldata" style="width:16px;height:16px;">
                            <label for="set_deldata" style="font-weight:bold;color:#ff6b6b;">删除数据文件</label>
                        </div>
                        <div style="padding-left:24px;opacity:.5;font-size:11px;margin-top:3px;">勾选后点击保存将删除所有流量数据和自定义名称</div>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;font-size:11px;opacity:.5;">
                        当前视图: ${uiMode==='mobile'?'&#x1F4F1; 手机(隐藏MAC+信号)':'&#x1F5A5;&#xFE0F; 桌面(显示全部)'}<br>
                        每日归档: ${archiveSettings.dailyEnabled ? '&#x2713;' : '&#x2717;'} ${pad(archiveSettings.dailyHour)}:${pad(archiveSettings.dailyMinute)}<br>
                        每月归档: ${archiveSettings.monthlyEnabled ? '&#x2713;' : '&#x2717;'} ${archiveSettings.monthlyDay}日 ${pad(archiveSettings.monthlyHour)}:00<br>
                        归档后重计: ${archiveSettings.resetAfterArchive!==false ? '&#x2713;' : '&#x2717;'}<br>
                        刷新间隔: ${archiveSettings.refreshSeconds ?? DEFAULT_REFRESH_SEC}秒<br>
                        IPv6监测: ${hasIp6tables ? (enableIPv6 ? '&#x2713; 已启用' : '&#x2717; 已关闭') : '&#x2717; 系统不支持'}
                    </div>
                </div>`
        });
        showModal(id);
    };

    const toggleMonitor = async (on) => {
        if (pluginUninstalled) return;
        const btn = document.querySelector('#kano_traffic_monitor_btn');
        if (on) {
            monitorTickCount = 0;
            monitorTimer = requestInterval(() => { monitorTick(); }, getRefreshInterval()); // v20.2.0(L2): 使用可配刷新间隔
            if (btn) { btn.textContent = '停止监控'; btn.style.background = 'var(--dark-btn-color-active)'; }
            localStorage.setItem(MONITOR_STATE_KEY, '1');
            await refresh(); // 启动时先做一次完整刷新（含规则同步/adopt）
        } else {
            if (monitorTimer) { monitorTimer(); monitorTimer = null; }
            if (btn) { btn.textContent = '自动监控'; btn.style.background = ''; }
            localStorage.setItem(MONITOR_STATE_KEY, '0');
            await flushHistory(true); // B8: 停止自动监控强制落盘
        }
    };
    // ============================================================
    //  UI 模式切换
    // ============================================================

    const UI_MODE_KEY = 'kano_traffic_ui_mode';
    let uiMode = localStorage.getItem(UI_MODE_KEY) || 'desktop';

    const applyUiMode = () => {
        const tableWrap = document.querySelector('#kano_traffic_table_wrap');
        if (!tableWrap) return;
        if (uiMode === 'mobile') {
            tableWrap.classList.add('kano-mobile');
        } else {
            tableWrap.classList.remove('kano-mobile');
        }
    };

    const toggleUiMode = () => {
        uiMode = uiMode === 'desktop' ? 'mobile' : 'desktop';
        localStorage.setItem(UI_MODE_KEY, uiMode);
        applyUiMode();
        createToast(uiMode === 'mobile' ? '已切换到手机视图' : '已切换到桌面视图', 'green');
    };

    // ============================================================
    //  UI 构建
    // ============================================================

    const mmContainer = document.querySelector('.functions-container');
    if (!mmContainer) return;

    mmContainer.insertAdjacentHTML("afterend", `
        <style>
            #IFRAME_KANO_TRAFFIC .kano-tbl { width:100%; border-collapse:collapse; font-size:12px; }
            #IFRAME_KANO_TRAFFIC .kano-tbl th, #IFRAME_KANO_TRAFFIC .kano-tbl td { white-space:nowrap; }
            /* v20.2.0(L5): 表格横向滚动常开 —— 任何宽度下列放不下都可滑动，不再挤压溢出 */
            #IFRAME_KANO_TRAFFIC #kano_traffic_table_wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%; }
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl { min-width:380px; font-size:11px; }
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl th { padding:8px 6px !important; font-size:9px !important; }
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl td { padding:8px 6px !important; }
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl th:nth-child(2),
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl th:nth-child(3),
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl .kano-mac,
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-tbl .kano-signal { display:none !important; }
            #IFRAME_KANO_TRAFFIC .kano-mobile .kano-hostname { font-size:12px; }
            /* v20.2.0(L5): 容器级紧凑模式 —— ResizeObserver 按容器实际宽度加 .kano-compact，
               不依赖视口@media(在UFI容器/分屏/桌面窄栏下同样生效) */
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl { font-size:10px; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th { padding:6px 4px !important; font-size:9px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl td { padding:6px 4px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(2),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl th:nth-child(3),
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl .kano-mac,
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-tbl .kano-signal { display:none !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-hostname { font-size:12px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-btn-row { gap:5px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .kano-btn-row button { font-size:10px !important; padding:3px 7px !important; }
            #IFRAME_KANO_TRAFFIC.kano-compact .title strong { font-size:14px; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-btn-row button { font-size:9px !important; padding:2px 5px !important; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl { font-size:9px; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl th { padding:5px 3px !important; }
            #IFRAME_KANO_TRAFFIC.kano-narrow .kano-tbl td { padding:5px 3px !important; }
            /* v20 响应式优化 */
            #IFRAME_KANO_TRAFFIC .kano-btn-row { display:flex; gap:8px; flex-wrap:wrap; }
            #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:12px; padding:4px 10px; }
            /* 视口@media 保留为兜底(整页宽度足够小时直接生效，无需等JS) */
            @media(max-width:480px){
                #IFRAME_KANO_TRAFFIC .kano-btn-row { gap:5px; }
                #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:10px !important; padding:3px 7px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl { font-size:10px; }
                #IFRAME_KANO_TRAFFIC .kano-tbl th { padding:6px 4px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl td { padding:6px 4px !important; }
                #IFRAME_KANO_TRAFFIC .title strong { font-size:14px; }
            }
            @media(max-width:380px){
                #IFRAME_KANO_TRAFFIC .kano-btn-row button { font-size:9px !important; padding:2px 5px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl { font-size:9px; }
                #IFRAME_KANO_TRAFFIC .kano-tbl th { padding:5px 3px !important; }
                #IFRAME_KANO_TRAFFIC .kano-tbl td { padding:5px 3px !important; }
            }
        </style>
        <div id="IFRAME_KANO_TRAFFIC" style="width:100%;margin-top:10px;">
            <div class="title" style="margin:6px 0;"><strong>设备流量监控</strong><div style="display:inline-block;" id="collapse_traffic_btn"></div></div>
            <div class="collapse" id="collapse_traffic" data-name="close" style="height:0px;overflow:hidden;">
                <div class="collapse_box">
                    <div id="kano_traffic_overview" style="margin-bottom:10px;"></div>
                    <div class="kano-btn-row" style="margin-bottom:10px;">
                        <button id="kano_traffic_refresh_btn">刷新</button>
                        <button id="kano_traffic_monitor_btn">自动监控</button>
                        <button id="kano_traffic_diag_btn" style="font-size:12px;padding:4px 10px;">诊断</button>
                        <button id="kano_traffic_log_btn" style="background:rgba(56,189,248,0.1);color:#38bdf8;border-color:rgba(56,189,248,0.2);font-size:12px;padding:4px 10px;">📋 日志</button>
                        <button id="kano_traffic_settings_btn" style="background:rgba(148,163,184,0.1);color:#94a3b8;border-color:rgba(148,163,184,0.2);font-size:12px;padding:4px 10px;">&#x2699;&#xFE0F; 设置</button>
                        <button id="kano_traffic_engine_btn" style="background:rgba(45,212,191,0.1);color:#2dd4bf;border-color:rgba(45,212,191,0.2);font-size:12px;padding:4px 10px;">&#x2699;&#xFE0F; 引擎</button>
                        <button id="kano_traffic_archive_btn" style="background:rgba(167,139,250,0.1);color:#a78bfa;border-color:rgba(167,139,250,0.2);font-size:12px;padding:4px 10px;">&#x1F4CB; 归档并重计</button>
                        <button id="kano_traffic_history_btn" style="background:rgba(96,165,250,0.1);color:#60a5fa;border-color:rgba(96,165,250,0.2);font-size:12px;padding:4px 10px;">&#x1F4CB; 查看历史</button>
                        <button id="kano_traffic_rank_btn" style="background:rgba(74,222,128,0.1);color:#4ade80;border-color:rgba(74,222,128,0.2);font-size:12px;padding:4px 10px;">&#x1F3C6; 流量排行</button>
                        <button id="kano_traffic_cleartraffic_btn" style="background:rgba(251,146,60,0.1);color:#fb923c;border-color:rgba(251,146,60,0.2);font-size:12px;padding:4px 10px;">清除全部流量</button>
                        <button id="kano_traffic_uninstall_btn" style="background:rgba(120,120,120,0.1);color:#888;border-color:rgba(255,255,255,0.1);font-size:12px;padding:4px 10px;">&#x1F5D1; 卸载插件</button>
                    </div>
                    <div id="kano_traffic_table_wrap" style="border-radius:10px;background:rgba(255,255,255,0.015);">
                        <table id="kano_traffic_table" class="kano-tbl">
                            <thead><tr style="border-bottom:2px solid rgba(255,255,255,0.08);font-size:10px;opacity:.65;">
                                <th style="padding:10px 8px;text-align:left;">设备 &#x270F;&#xFE0F;</th>
                                <th style="padding:10px 8px;text-align:left;">MAC</th>
                                <th style="padding:10px 8px;text-align:center;">信号</th>
                                <th style="padding:10px 8px;text-align:right;">&#x2B06;&#xFE0F;</th>
                                <th style="padding:10px 8px;text-align:right;">&#x2B07;&#xFE0F;</th>
                                <th style="padding:10px 8px;text-align:right;min-width:90px;">总流量</th>
                                <th style="padding:10px 4px;text-align:center;width:30px;"></th>
                            </tr></thead>
                            <tbody id="kano_traffic_tbody"><tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">点击「刷新」</td></tr></tbody>
                        </table>
                    </div>
                    <div style="margin-top:10px;font-size:10px;opacity:.45;text-align:center;">
                        conntrack引擎+iptables双统计 | 数据保存在设备内 | &#x270F;&#xFE0F;改名 &#x1F5D1;删除 &#x1F4CB;归档 &#x1F3C6;排行 | v21.0.4
                    </div>
                </div>
            </div>
        </div>
    `);

    collapseGen("#collapse_traffic_btn", "#collapse_traffic", "#collapse_traffic", (newVal) => { if (newVal == 'open') refresh(); });

    // v20.2.0(L5): 容器级响应式 —— 监听 #IFRAME_KANO_TRAFFIC 实际宽度(而非视口)，
    // <560px 加 kano-compact(隐藏MAC/信号列+缩小字号)，<400px 再加 kano-narrow(极致紧凑)
    const _kanoRootEl = document.querySelector('#IFRAME_KANO_TRAFFIC');
    const applyResponsive = () => {
        const root = document.querySelector('#IFRAME_KANO_TRAFFIC');
        if (!root) return;
        const w = root.clientWidth;
        root.classList.toggle('kano-compact', w > 0 && w < 560);
        root.classList.toggle('kano-narrow', w > 0 && w < 400);
    };
    if (typeof ResizeObserver === 'function' && _kanoRootEl) {
        new ResizeObserver(applyResponsive).observe(_kanoRootEl);
    }
    window.addEventListener('resize', applyResponsive);
    applyResponsive();
    setTimeout(applyResponsive, 500); // 折叠面板展开/主题渲染后再校一次，避免初始化时宽度为0

    // v20.3.0(M5): 页面隐藏/关闭时尽力落盘(30s节流窗口内的未存数据)；恢复可见时立即补一个 tick，
    // 挂起期间 iptables 计数持续增长，恢复后立刻并入统计，速率按真实挂起时长平均(不虚高)
    document.addEventListener('visibilitychange', () => {
        if (pluginUninstalled) return;
        if (document.hidden) { flushHistory(true); }
        else if (monitorTimer) { monitorTick(); }
    });
    window.addEventListener('pagehide', () => { if (!pluginUninstalled) flushHistory(true); });

    document.querySelector('#kano_traffic_refresh_btn').addEventListener('click', refresh);
    document.querySelector('#kano_traffic_monitor_btn').addEventListener('click', () => toggleMonitor(monitorTimer === null));
    document.querySelector('#kano_traffic_diag_btn').addEventListener('click', showDiagModal);
    document.querySelector('#kano_traffic_log_btn')?.addEventListener('click', showLogModal);
    document.querySelector('#kano_traffic_settings_btn').addEventListener('click', showSettingsModal);
    document.querySelector('#kano_traffic_engine_btn').addEventListener('click', showEngineModal); // v21.0.0(P4)
    document.querySelector('#kano_traffic_rank_btn').addEventListener('click', showRankModal);

    document.querySelector('#kano_traffic_archive_btn').addEventListener('click', () => {
        if (pluginUninstalled) return;
        const { id, el } = createModal({
            name: 'traffic_archive_modal', title: '&#x1F4CB; 选择归档方式', maxWidth: 'min(360px, 94vw)',
            showConfirm: true, confirmBtnText: '归档并重计', closeBtnText: '取消',
            onClose: () => true,
            onConfirm: async () => { await archiveAndReset(null, true); return true; },
            content: `<div style="font-size:13px;line-height:1.6;opacity:.85;">
                <div style="background:rgba(167,139,250,0.08);padding:10px;border-radius:6px;margin-bottom:8px;">
                    <div style="font-weight:bold;color:#a78bfa;">&#x1F4CB; 归档并重计</div>
                    <div style="opacity:.6;font-size:11px;">保存当前流量快照，然后清零所有计数器重新开始统计</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;margin-bottom:8px;">
                    <div style="font-weight:bold;opacity:.8;">&#x1F4CB; 仅归档</div>
                    <div style="opacity:.6;font-size:11px;">保存当前流量快照，不清零，继续累计统计</div>
                </div>
                <button id="kano_archive_only_btn" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:inherit;cursor:pointer;font-size:13px;margin-top:4px;">仅归档</button>
            </div>`
        });
        showModal(id);
        setTimeout(() => {
            const onlyBtn = el.querySelector('#kano_archive_only_btn');
            if (onlyBtn) {
                onlyBtn.addEventListener('click', async () => {
                    closeModal(id);
                    await archiveAndReset(null, false);
                });
            }
        }, 50);
    });

    document.querySelector('#kano_traffic_history_btn').addEventListener('click', showHistoryModal);

    document.querySelector('#kano_traffic_cleartraffic_btn').addEventListener('click', async () => {
        if (pluginUninstalled) return;
        resetClickCount++;
        if (resetClickTimer) clearTimeout(resetClickTimer);
        resetClickTimer = setTimeout(() => { resetClickCount = 0; }, 4000);
        if (resetClickCount < 2) { createToast('再次确认清除全部流量 (' + resetClickCount + '/2)', 'pink', 3000); return; }
        resetClickCount = 0;
        await clearAllTraffic();
    });

    document.querySelector('#kano_traffic_uninstall_btn').addEventListener('click', async () => {
        if (pluginUninstalled) return;
        resetClickCount++;
        if (resetClickTimer) clearTimeout(resetClickTimer);
        resetClickTimer = setTimeout(() => { resetClickCount = 0; }, 4000);
        if (resetClickCount < 5) { createToast('再次确认卸载插件 (' + resetClickCount + '/5)', 'pink', 3000); return; }
        resetClickCount = 0;
        await uninstallPlugin();
    });

    // 从设备文件加载数据
    // v20.0.1(F4): 高级功能前置校验——未开启时明确提示，而非误报"未检测到 iptables"
    if (!(await _hasRoot())) {
        createToast('高级功能未开启或 root 不可用：流量统计与限速将无法工作，请先启用高级功能', 'pink', 8000);
    }
    await detectIptables();
    await detectIp6tables();
    await loadData();
    loadSettings();
    await detectLimitMode(); // v19.10.0: 探测 hashlimit/limit 模块（临时链实测，失败优雅降级）
    cleanOldLogs(); // v20.1.0(G3): 启动时清理过期日志（后台执行，不阻塞启动）
    // v19.10.0: 启动(adopt 前) —— 有限速配置则确保链挂载(旧规则页面关闭期间持续生效，首次完整同步时重建)；无配置则清理残留链
    if (limitMode !== null && hasActiveLimits()) {
        await mountLimitChains();
        limitChainsMounted = true;
    } else {
        await unmountLimitChains();
    }
    applyUiMode();
    startAutoArchive();
    startHeartbeat(); // v21.0.2(R1): 多端心跳, 自动归档选主用

    // v21.0.0(P5): 引擎已安装则确保运行(设备重启/引擎异常退出后自动拉起)；静默检查云端更新(有新版仅 toast 一次)
    if (await _hasRoot()) {
        try {
            const r = await runShellWithRoot(`[ -x ${ENGINE_BIN} ] && echo ENG_Y || echo ENG_N`);
            if (_sh(r).includes('ENG_Y')) await startEngine();
        } catch (e) {}
        checkEngineUpdate(false).then((res) => {
            // v21.0.2(R4): 插件自身新版本静默检查(与引擎同一份清单, 不重复请求)
            if (res && res.manifest && res.manifest.jsRev && _verNewer(res.manifest.jsRev, PLUGIN_VERSION)) {
                createToast(`插件有新版本 v${res.manifest.jsRev}(当前 v${PLUGIN_VERSION})，点「🛠️ 引擎」→「🔄 更新插件」一键更新`, 'pink', 8000);
                _log('ENGINE', `插件云端版本 v${res.manifest.jsRev} 本机 v${PLUGIN_VERSION} → 可更新`);
            }
        }).catch(() => {});
    }

    // v20.0.1(F7): 监控自启已含完整 refresh，面板展开刷新与之互斥，避免并发双刷
    if (localStorage.getItem(MONITOR_STATE_KEY) === '1') setTimeout(() => toggleMonitor(true), 1000);
    else if (localStorage.getItem("#collapse_traffic") === 'open') setTimeout(() => refresh(), 800);

    console.log('[设备流量监控] v21.0.4 已加载');
    _log('INIT', 'v21.0.4 插件启动');
})();
//</script>