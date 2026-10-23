# 剧本画布 · Script Canvas

用于视频创作的 Windows 本地无限画布。把剧本、场景、镜头、角色、参考图、视频及 BGM 放在同一张画布里，查看关系并整理素材。

## 下载使用（Windows）

[下载 Windows 解压即用版](https://github.com/Ginwow/script-canvas/releases/latest)

在 Releases 的 Assets 中下载 `ScriptCanvas-v0.1.0-Windows-x64.zip`，完整解压后双击 `剧本画布.exe`。无需安装 Node.js；请保留同目录的运行文件。`Source code` 是开发用源码，不是可直接运行的程序。发行包不含作者的个人工程与素材。

## 功能

- 剧本 → 场景 → 镜头的层级结构，支持新增、删除及顺序编号。
- 角色设定图、镜头参考图、封面、成片视频和 BGM 的拖入、粘贴与关联。
- 节点编辑、多选移动、连线解除、撤销及重做。
- 侧栏详情、素材分类、静态位置地图和图片查看。
- 项目使用 UTF-8 JSON 与项目内相对素材路径；保存支持事务恢复和历史素材保护。
- 内容修改自动保存；移动节点、调整卡片大小只在主动保存时写入。平移与缩放视角不会触发保存。

当前版本是本地工作台，不提供内置聊天、AI 生图或云端同步，不需要 API 密钥。批量图片复制使用 Windows 剪贴板，目标软件是否接收多张图片取决于目标软件。

## 开发运行

支持 Windows 10/11。先安装 Node.js 22 或更新的受支持版本以及 npm，然后运行：

```powershell
git clone https://github.com/Ginwow/script-canvas.git
cd script-canvas
npm ci
npm start
```

也可以使用仓库中的“安装依赖.bat”和“启动桌面程序.bat”。Linux/macOS 只用于部分自动检查，尚未完成桌面功能验收。

## 数据目录

优先使用环境变量 `CANVAS_DATA_DIR` 指定的绝对目录。未指定时，程序会寻找自身目录及上级目录中的既有“剧本/参考素材库/项目”目录；全新安装则使用系统文档目录下的“剧本画布”。项目与公用素材分别放在数据目录的“剧本”和“参考素材库”下。

```powershell
$env:CANVAS_DATA_DIR = 'C:\CanvasData'
npm start
```

本地缓存和运行状态位于 Electron 用户数据目录。请备份整个剧本项目目录，包括 JSON 和 assets。仓库不包含作者的个人剧本、素材、缓存或恢复备份。

## 操作与保存

| 操作 | 方式 |
| --- | --- |
| 保存内容及当前节点位置、尺寸 | Ctrl+S |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Shift+Z 或 Ctrl+Y |
| 编辑节点正文 | 双击内容 |
| 折叠 / 展开节点 | 点击标题栏 |
| 多选节点 | Alt+左键选择 |
| 新增场景、镜头等 | 画布右键菜单 |
| 删除 | 节点右键菜单或 Delete |
| 从磁盘刷新 | R（非编辑状态） |

关闭时，实际内容变化仍会询问是否保存；“不保存”只跳过最后一次保存，不能撤回此前已自动保存的内容。单独移动或调整卡片大小不会触发关闭提醒；若要保留这些变化，请先按 Ctrl+S。

## 检查与打包

```powershell
npm test
npm run check:publish
npm audit
npm run dist:win
# 可选：生成单文件便携版本
npm run dist:win:portable
```

目录版主程序位于 `dist/win-unpacked/剧本画布.exe`。目录版需保留同目录的运行时及 resources。当前构建未进行代码签名。首次运行及打包需要网络下载依赖。

[数据格式](canvas-project.schema.json)、[空白模板](project-template.json)、[项目生成技能](canvas-project-json-skill/SKILL.md)。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。依赖遵循各自的许可证；打包产物中的 Electron/Chromium 第三方许可证应一并保留。
