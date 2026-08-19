#!/bin/bash
# ============================================================
# kano_traffic 插件静态检查脚本 (v21.1.34)
# 用法: bash kano_engine/dist/check.sh [插件js文件]
# 自动抓 v21.1.32 踩过的两类"按钮无反应"bug:
#   ① 渲染出来的按钮没有绑事件 (id 出现但无 addEventListener)
#   ② createModal 漏传 onClose (取消按钮无回调不关闭)
# 附带: 括号状态机平衡检查 + 版本号三处一致性
# ============================================================
JS="${1:-设备流量监控插件v21.1.34.js}"
[ -f "$JS" ] || { echo "✗ 找不到 $JS"; exit 1; }
PASS=0; FAIL=0

ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# ---------- ① 按钮/可点元素 id ↔ 事件绑定交叉比对 ----------
echo "== ① 按钮事件绑定检查 =="
# 模板里静态出现的按钮类 id (kano_xxx_btn / kano_xxx_modal / *_inline 等; 动态拼接的 ${var} 抓不到, 走委托/人工)
TMPL_IDS=$(grep -oE 'id="[^"]*(btn|modal|_inline)[^"]*"' "$JS" | sed 's/id="//;s/"//' | sort -u)
# 事件绑定里引用到的 id: getElementById('x') / querySelector('#x') / collapseGen('x' 等动态生成器
BOUND_IDS=$(grep -oE "(getElementById|querySelector|collapseGen|collapseTo|bindBtn)\(['\"][#'\"]?[a-zA-Z0-9_-]+" "$JS" \
  | grep -oE '[a-zA-Z][a-zA-Z0-9_-]+$' | sed 's/^#//' | sort -u)
MISSING=0
if [ -n "$TMPL_IDS" ]; then
  # 单次 awk 完成: 计数 + 绑定引用判断 (MSYS2 管道 fork 开销极大, 禁止 shell 循环逐 id grep)
  MISS_LIST=$(awk -v ids="$TMPL_IDS" -v bnd="$BOUND_IDS" '
    BEGIN{ n=split(ids, a, "\n"); for(i=1;i<=n;i++){ cnt[a[i]]=0; bndMap[a[i]]=0 } m=split(bnd, b, "\n"); for(i=1;i<=m;i++) if(b[i]!="") bndMap[b[i]]=1 }
    { for(i=1;i<=n;i++){ id=a[i]; s=$0; while((p=index(s,id))>0){ cnt[id]++; s=substr(s,p+length(id)); } } }
    END{ miss=0; for(i=1;i<=n;i++){ if(bndMap[a[i]]==0 && cnt[a[i]]<=2){ print "  ✗ 疑似漏绑事件: id=\"" a[i] "\" 全文件仅 " cnt[a[i]] " 次, 且无事件绑定引用"; miss++ } } exit miss }' "$JS")
  MISSING=$?
  if [ -n "$MISS_LIST" ]; then echo "$MISS_LIST"; fi
fi
if [ "$MISSING" -eq 0 ]; then ok "模板按钮/弹窗 id 全部有事件绑定引用 ($(echo "$TMPL_IDS" | wc -l) 个静态 id)"; else bad "发现 $MISSING 个疑似漏绑按钮(参考 v21.1.32 按日按钮坑)"; fi

# ---------- ② createModal ↔ onClose ----------
echo "== ② createModal onClose 检查 =="
CREATES=0; NOCLOSE=0
# 逐块扫描: 每个 createModal({ ... }) 配置块内必须出现 onClose 键 (v21.1.32 rank_range_modal 坑)
awk 'BEGIN{ CREATES=0; NOCLOSE=0 }
  { line = $0 }
  { for(;;){ i=index(line,"createModal({");
      if(!i) break;
      # 找到从 createModal({ 起的配置块(找配对 }), 用简化括号计数
      rest=substr(line,i+12); b=1; j=0; block="";
      # 从当前行拼接直到括号平衡
      buf=rest; lc=length(rest);
      for(k=1;k<=lc && b>0;k++){ c=substr(rest,k,1); if(c=="{")b++; else if(c=="}")b--; }
      if(b>0){ # 跨行
        for(;;){ if(getline<=0) break; buf=buf "\n" $0; lc=length($0);
          for(k=1;k<=lc && b>0;k++){ c=substr($0,k,1); if(c=="{")b++; else if(c=="}")b--; }
          if(b<=0) break; }
      }
      CREATES++;
      if(buf !~ /onClose[[:space:]]*:/){ print "  ✗ createModal 漏传 onClose: " substr(buf,1,80) "..."; NOCLOSE++ }
      line=substr(line,i+12+length(rest));
    }
  }
  END{ print "  createModal 共 " CREATES " 处, 漏 onClose " NOCLOSE " 处"; exit NOCLOSE>0 ? 1 : 0 }
' "$JS" && ok "createModal 全部带 onClose" || bad "存在 createModal 漏 onClose(取消键会无反应)"

# ---------- ③ 括号状态机 (基线: braces=-1 parens=2 brackets=0 err=6) ----------
echo "== ③ 括号状态机 =="
awk '
  { for(i=1;i<=length($0);i++){
      c=substr($0,i,1);
      if(c=="{"){b++} else if(c=="}"){b--}
      else if(c=="("){p++} else if(c==")"){p--}
      else if(c=="["){k++} else if(c=="]"){k--}
      else if(c=="\""||c=="\x27"){ if(instr==c){instr=0} else if(!instr){instr=c} }
    }
  }
  END{ print "  braces="b" parens="p" brackets="k" (基线 v30/v31/v32/v33: braces=-1 parens=2 brackets=0 err=6, 模板${}嵌套的已知误判, 数字一致即可)" }
' "$JS"
ok "括号状态机已输出 (与基线比对)"

# ---------- ④ 版本号三处一致性 ----------
echo "== ④ 版本号一致性 =="
PV=$(grep -oE "PLUGIN_VERSION = '[^']+'" "$JS" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
LR=$(grep -oE '"jsRev": "[^"]+"' kano_engine/dist/latest.json 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
BR=$(grep -oE 'JSREV="[0-9.]+"' kano_engine/dist/build_pack.sh 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "  插件 PLUGIN_VERSION=$PV  latest.json jsRev=$LR  build_pack.sh JSREV=$BR"
if [ -n "$PV" ] && [ "$PV" = "$LR" ] && [ "$PV" = "$BR" ]; then ok "三处版本号一致 ($PV)"; else bad "版本号不一致!"; fi

echo
echo "== 结果: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && echo "全部通过" || echo "存在失败项, 见上方 ✗"
exit $FAIL
