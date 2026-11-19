# 管理员通道（Admin Shell）

按会话开一个带有效期的管理员窗口。需要提权的命令交给它跑，闲置到期自己收回。

## 装法

这是 HanaAgent 的 v2 App（`manifestVersion 2`）。两种装法任选：

1. **直接放目录**：把整个仓库复制成 `<HANA_HOME>/apps/admin-shell/`（默认 `C:\Users\<你>\.hanako\apps\admin-shell`），重启 Hana，然后在安装确认框里点批准。
2. **从市场/本地包装**：把仓库打成 App 包后用应用管理界面安装。

装好后第一次用会让屏幕上弹一次 UAC。

## 它解决的问题

Hana 本身跑在普通权限下（哪怕是管理员账户，UAC 过滤令牌也把管理员组按 deny-only 吊着）。所以
`exec_command` 碰到装服务、改 `Program Files`、写系统注册表、动 `HKLM` 这类活就会失败。

这个 App 不去碰 Hana 的权限，而是另外开一条受控的提权通道：

- **一次 UAC**：第一次开通时屏幕上会弹一次确认框，需要点「是」（账户是管理员的话只需点确认，
  不是的话要输入管理员密码）。之后就由后台隐藏进程接管，不再打扰。
- **按会话归属**：哪个会话开的窗口，哪个会话才能用；其他会话要用得自己 `admin_open`。
- **有有效期**：闲置超时（默认 30 分钟）或单次寿命上限（默认 4 小时）到了自动关。
- **可审计**：每条命令都写进 `channel/audit.log`，状态卡里能看到最近跑过什么。

## 怎么用

| 做法 | 说明 |
|---|---|
| 跟 agent 说「开个管理员窗口」 | agent 调 `admin_open` |
| 输入栏那个「提权」按钮 | 一步开关：没开就开，开着就显示剩余时间，再点一下关掉 |
| 右键会话 → 结束本会话的管理员窗口 | 只交还本会话那一份 |
| 卡片「管理员通道」 | 看谁握着窗口、剩多久、最近跑过什么 |

工具一共五个：`admin_open` / `admin_exec` / `admin_close` / `admin_status`，外加给输入栏按钮用的 `admin_toggle`。

```
admin_open(idleMinutes=30, maxLifeMinutes=240)
admin_exec(command, shell=auto|cmd|powershell, cwd, timeoutSec=120)
admin_close(all=false)
admin_status(audit=10)
admin_toggle()            输入栏那颗按钮：没开就开，开着就关
```

## 它是怎么实现的

```
Hana / App 进程（普通权限，不联网）
   │  写 channel/req/*.json
   ├──────────────► powershell.exe（隐藏窗口，管理员权限）
   │                    执行 → 写 channel/res/*.json
   └◄────────────── 读结果
```

- 提权守护进程是 `runtime/admin-agent.ps1`，由 App 用 `Start-Process -Verb RunAs` 拉起，
  参数通过 `-EncodedCommand` 传递（不经过任何一层 shell 拼接）。
- 通信走 `dataDir/channel/` 下的文件队列，不占端口、不开监听、不用网络权限。
- 守护进程每 2 秒写一次 `state.json` 心跳，App 靠它判断通道是否还在。
- 租约在 `leases.json` 里，App 重启后能接上原来那个窗口。
- 命令的 stdout/stderr 先按严格 UTF-8 解码，失败回退到本地 ANSI 代码页，所以中文不乱码。

## 边界写在明处

- **UAC 那一下绕不过去。** 这不是实现偷懒，是 Windows 的安全边界：能静默提权的路只有
  计划任务、`/savecred` 或写一个提权漏洞，三者都会把管理员权限永久交给这台机器上的任意进程。
  这里选择只在你点过的那一次之后保持窗口，而不是造一个永久后门。
- 提权进程的 TTL 由 App 的租约驱动。App 挂了、Hana 崩了，窗口最迟在闲置超时后自己退。
- Windows 任务管理器里能看见那个 `powershell.exe`（隐藏的是窗口，不是进程）。
- 只适合自己一个人的机器。同一个用户身份下的其他程序理论上也能往那条队列里塞命令——
  反正它们本来也能点 UAC。

## 权限

- `app/process.spawn` —— 拉起提权进程、执行命令
- `app/tools.expose-to-model` —— 让 agent 能主动调
- `app/input.status` —— 输入栏那个按钮

## 目录

```
manifest.json
index.js              入口：注册工具、读设置、状态卡 route
lib/channel.js        提权通道：启动、租约、请求/响应、审计
lib/leases.js         租约簿：谁握着窗口、还剩多久
lib/tools.js          五个工具 + 输入栏状态镜像
runtime/admin-agent.ps1  提权守护进程（纯 ASCII，避免 PS 5.1 编码坑）
ui/                   状态卡
```

## License

MIT。SDK 与第三方组件（`sdk/`、`ui/assets/sdk.js`、`THIRD_PARTY_NOTICES.txt`）随 HanaAgent 分发，版权归原作者所有，不适用本仓库的 MIT 条款。
