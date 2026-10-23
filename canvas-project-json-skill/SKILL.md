---
name: canvas-project-json
description: Create or update import-ready v3 JSON projects for the 白画布视频工作台 from screenplay material, outlines, shot lists, or existing canvas projects. Use when the requested output must import into that canvas; not for screenplay critique alone or generic JSON.
---

# 白画布项目 JSON

把剧本会话里的已确认故事资料整理成白画布可导入的 UTF-8 JSON 文件。按需使用本 Skill 附带的 [项目 Schema](references/canvas-project.schema.json)；此格式无需联网查找。

## 结构规则

根对象只包含 `format`、`version`、`project`、`synopsis`、`visualStyle`、`characters`、`shots`、`storyboards`、`canvas`。使用 `format: "white-canvas-video-project"` 和 `version: 3`。完整字段及上限以附带 Schema 为准，不要添加画布不支持的字段。

- `project.title` 是项目/剧本名；`synopsis` 和 `visualStyle` 是根级字符串节点。没有明确画风资料时将 `visualStyle` 留空，不要自创风格。
- `project.codex` 是可选的历史来源会话记录，不生成画布节点，也不启动连接。已有项目中的标记应保留；新项目默认省略，无需取得来源会话 ID。若用户要求记录来源，只写入真实 `threadId`（UUID）及可选 `hostId`（当前仅支持 `local`）、`threadTitle`、`projectName`。
- `characters` 保存角色 `id`、`name`、可选 `setting` 和真实存在的 `referenceImages`。
- `shots` 保存场景 `id`、可选 `title`、`time`、`duration`、`description`。场景描述连续时间与地点下的剧情、时间和时长，不放视频生成提示词或图片。
- `storyboards` 保存 `id`、必需的 `shotId`、可选 `title`、`prompt`、`keyframes`、`referenceImages`。每个镜头必须通过 `shotId` 指向 `shots` 中已有的场景。同一场景可以有一个或多个镜头；每段独立生成的视频片段对应一个镜头，按所属场景分别从镜头01编号。起始帧和结束帧属于同一片段时放在同一镜头内。

画布会自动建立“剧本 → 剧情梗概/画风/角色分组/场景主节点”，角色挂在角色分组下；场景主节点由画布生成，各场景挂在其下，镜头再挂到所属场景，图片挂在角色或镜头下。不要在 JSON 中创建这些合成分组或连接字段到核心内容区；布局连线只放在 `canvas`。

## 单文件画布保存（v3）

必须提供根级 `canvas` 对象：`{"view":{"x":0,"y":0,"scale":1},"nodes":[],"connections":[],"shotLaneLayoutVersion":2}`。首次从剧本生成时允许空 nodes/connections，画布根据核心人物、场景、镜头和图片引用自动建立布局，自动保存时填入真实节点。不要编造图片路径或绝对项目路径。

更新已有文件时保留 canvas 的节点 ID、坐标、尺寸、折叠状态、图片缩放及连线；修改核心正文时同步更新对应 canvas 节点的 text/title，图片引用同步到 assetPath 与连接。非空 canvas 为实际画布快照，必须完整包含要显示的节点，不能仅放部分修改。节点 kind 与字段、数量上限严格按 Schema；节点 ID 唯一，connections 的 fromId/toId 都引用真实节点。canvas 节点与连线端点 ID 允许保留合成 ID __shot-group（导入校验不得因其下划线开头拒绝）；普通 ID 仍以英文数字开头。合成节点 ID 使用 script、plot、style、roles、__shot-group（这些 ID 仍不能用于核心角色/场景/镜头）。素材节点使用 kind=asset 和项目内相对 assetPath，不写 projectPath。保留原有 canvas 中未要求修改的独立提示词或图片节点。

旧 v1/v2 可以导入；新生成及保存统一 v3。旧状态文件由程序读取后合并到同名剧本 JSON，确认写入成功后删除状态文件。剧本内容、所有节点、素材关联和布局仅保存一个剧本 JSON。

## 桌面端讨论与画布存储

剧本讨论、参考图生成在桌面端进行。画布只负责导入、编辑、保存剧本节点、图片引用和布局，不提供聊天、生图或会话绑定功能。更新已有 JSON 时保留可选的 `project.codex` 来源记录；不依赖它取得内容或执行操作，不要求用户提供会话地址。旧 `canvas.nodes[].includeInChat` 仅作兼容记录，当前画布不使用它发送上下文。

## 制作步骤

### 文件名与素材目录

剧本 JSON 文件名为 `<project.title>.json`，项目文件夹也使用同一个剧本名，不加“画布项目”、日期、随机 ID 或哈希后缀。Windows 禁用字符 `< > : " / \\ | ? *` 及控制字符统一替换为 `-`，去掉首尾空白和末尾句点；文件与目录使用同一个处理结果。名称超过 100 字或为 Windows 保留名时先要求有效剧本名，不静默截断。

导入画布后的标准目录为 `<数据目录>/剧本/<剧本名>/<剧本名>.json`，项目生成素材放入同项目 `assets/` 子目录。同名项目目录不存在时创建；已有同名项目时直接打开本地已保存项目，保留节点、图片和连线，不用外部旧 JSON 覆盖。不再生成单独的 `画布状态.json`，布局与连线保存在同一 JSON 的 `canvas` 字段。公用参考素材单独存放在 `<数据目录>/参考素材库`，只有用户选择存入公用库才加入；公用素材用于项目且写入 JSON 时，先复制到项目 `assets/`，JSON 只引用项目内相对路径。保留公用原图。交付 JSON 时按同名规则保存，不覆盖未授权修改的现有项目。

1. 从当前对话、用户提供的剧本/大纲/镜头资料及可访问的项目文件中提取已确认内容。维护已有角色姓名、人物关系、剧情事实和用户明确指定的场景要求。遇到互相冲突的版本，优先采用用户最近确认的版本；只有冲突会改变关键设定而无法判断时才询问。
2. 若用户要从剧本或梗概新建项目，先按场景、时间、机位/景别或明显动作变化拆镜头，再按可独立生成的连续视频片段拆分镜头。保持情节顺序与因果；不为凑数量拆镜。可以为可视化补足合理的机位、运镜、表演动作和画面衔接，但不得改变已确认的剧情事实。没有原始时间码时，不伪造精确时间；无法确定的可省略。提示词聚焦该片段的动作、构图、景别、机位、场景运动和关键连续性，需要时包含环境/声音提示。
3. 保留已有可选的 `project.codex` 来源记录，新项目默认省略。更新已有项目时保留现有稳定 ID 和未要求修改的内容。用已有 ID 对应实体；没有 ID 时可用明确的名称/标题匹配。不要仅因排序或文案变化而换 ID，不要静默删除或重写用户已有项目内容。
4. 为角色、场景和镜头分配唯一、稳定、简短的英文 slug ID，只用 ASCII 字母、数字、点、下划线或连字符；不得使用 `script`、`plot`、`style`、`roles`、`__shot-group`。每个 `storyboards[].shotId` 必须精确匹配一个 `shots[].id`。镜头数组按场景顺序排列，并保持同一场景内部的镜头顺序。
5. 只引用确实存在且准备随项目提供的图片。JSON 图片路径必须是 JSON 所在项目目录内的相对路径，统一用 `/`；不写绝对路径、Vault 路径、Obsidian 嵌入语法或猜测的文件名。角色设定图只接受 JPG/PNG；镜头图片接受 JPG/PNG/WebP/GIF。若用户要一份完整可导入的素材包且图片在可访问位置，可将副本放进 JSON 旁的 `assets/` 子目录，再写相对路径；保留原图，不覆盖现有文件。否则省略不可随包提供的图片引用。
6. 按附带 Schema 检查 JSON；另外确认所有 ID 全局唯一、保留 ID 未占用、每个镜头都能找到所属场景、所有引用图片在输出目录下实际存在，且根对象无额外字段。环境有 JSON Schema 校验器时使用它；没有时逐项对照 Schema 和上述关系约束。修复问题后再交付。
7. 用户要文件时，将最终 JSON 保存为 UTF-8 文件到用户指定位置；未指定时保存到当前任务工作区，避免覆盖同名文件。用户只要内容/示例时才在回复中直接输出 JSON。交付时报告文件路径、场景数、镜头数、角色数及未能提供的素材；不要自动打开画布、导入或替换当前画布。

## 与画布程序同步维护

在维护白画布程序时，如果任务改变了节点类型、节点字段或含义、父子关系、项目 JSON 版本、图片引用规则、ID 约束或导入校验，必须在同一项工作中检查并同步本 Skill 的规则和附带 Schema。以程序仓库根目录的 `canvas-project.schema.json` 作为 Schema 正本；更新附带副本，并保证两份一致。同步更新上方结构说明或示例中受影响的部分。只涉及颜色、布局、交互等且不改变可导入数据约定的程序修改，不需要改 Skill。若不能访问全局安装副本，应说明同步受限的位置，不要声称已经更新。

## 最小文件形状

以下为可直接使用的结构模板，无需来源会话标记。

```json
{
  "format": "white-canvas-video-project",
  "version": 3,
  "project": { "title": "项目名" },
  "synopsis": "剧情梗概",
  "visualStyle": "",
  "characters": [],
  "shots": [],
  "storyboards": [],
  "canvas": {"view":{"x":0,"y":0,"scale":1},"nodes":[],"connections":[],"shotLaneLayoutVersion":2}
}
```


### 子镜头拆分规则
画布按单个场景逐个讨论和修改。用户要求重做、拆分、增减镜头时，以该场景的新完整镜头方案更新 storyboards：修改可复用的原镜头，新增缺少的镜头，删除被替代或多余的旧镜头，并同步移除 canvas 中对应镜头节点及连接；编号在各父场景内从镜头01连续排列。仅更新目标场景，不改变其它场景。删除镜头节点不删除磁盘素材文件。
用户要求将一个场景拆为多个镜头时，每个镜头独立写入 storyboards，通过 shotId 关联原场景，按父场景内顺序命名镜头01、镜头02。场景 description 保留整体叙事，不能用正文中的 A/B 段落替代实际子镜头节点。同步 canvas.nodes 与 canvas.connections，保留已有素材关联。

镜头 ID 是固定身份，编号只是显示顺序。前插或重排镜头时保留原节点 ID、参考图和提示词连接；新镜头创建独立 ID，禁止按数组位置复用原镜头导致素材错绑。

## 视频素材
视频使用现有 kind=asset 节点，assetPath 为项目内相对路径，支持 MP4/WebM/MOV。视频只保存在 canvas.nodes，不写入 storyboards.referenceImages 或 keyframes。提示词节点（prompt，或连接在镜头下的 text）可连接视频素材，视频标题自动为生成视频；连接记录保存在 canvas.connections。

保存时视频物化到当前剧本项目的 assets/videos/，以视频内容去重；重复粘贴或保存相同视频复用已有文件，不按原始文件名重复复制。canvas.nodes.assetPath 保存物化后的相对路径。

## 镜头素材命名
保存时按实际场景→镜头→参考图/提示词→视频连接归属命名：场景01_镜头02_参考图01.png、场景01_镜头02_提示词01.txt、场景01_镜头02_视频01.mp4。同镜头多素材按连接顺序增加编号，提示词正文导出到 assets/prompts。图片在 assets/generated，视频在 assets/videos；JSON 路径同步更新，节点 ID 与连接不变。相同内容的视频复用首个归属的文件名，不生成副本；未绑定素材保留原名（相同视频共享文件）。

## 参考音频素材

音频沿用 `kind=asset` 节点，`assetPath` 为项目内相对路径，`fileName` 保存导入文件名；不新增音频节点类型或核心字段。支持 WAV/MP3/M4A/AAC/OGG/FLAC/WebM，存入项目 `assets/audio/`，按内容去重。WebM 位于 `assets/audio/` 或程序管理的撤销路径 `assets/.undo/audio/` 时作为音频，其余 WebM 仍作为视频。导入项目通常使用正式音频目录；撤销路径由程序管理。音频只保存在 `canvas.nodes`，可通过 `canvas.connections` 连接人物或其他画布节点，不得写入人物或镜头的 `referenceImages`、镜头 `keyframes`。

从公用参考素材库使用音频时保留库内原文件，并复制到当前项目 `assets/audio/` 后记录相对路径。已有项目内音频保存时保留路径与文件名；音频不参与参考图/视频编号重命名。更新项目时保留未要求修改的音频节点及连线，只引用随项目提供的真实音频文件。

## 术语兼容（2026-10-08）
画布显示层级为场景 → 镜头 → 参考图/提示词/视频。为兼容已有项目，shots 与 kind=shot 仍表示上层场景，storyboards 与 kind=storyboard 仍表示下层镜头，shotId 指向所属场景；shot-group 显示为场景。保留字段名、节点 ID 和连接，旧标题镜头XX/分镜XX在加载时按节点类型转换为场景XX/镜头XX。素材保存命名为场景XX_镜头XX_参考图XX等。

镜头(kind=storyboard)可直接连接视频asset，也可通过提示词连接视频。直接连接的视频同样按场景XX_镜头XX_视频XX命名；仅保存于canvas，不写入referenceImages/keyframes。

用户可拖离连接点取消任意可见连线；非空canvas快照中的节点与connections为实际状态，允许保留未连接节点，恢复时不要自动补回用户取消的既有节点连线。核心storyboards只包含仍有所属场景的镜头，未连接镜头保留在canvas；重新连接后恢复核心归属。

图片存储按内容指纹去重，重复图片节点保留各自ID与连线并引用同一个assetPath；角色参考图优先使用人物标题+两位序号，如林晚01.png、林晚02.png。同图用于镜头时直接复用角色文件路径；其它镜头图片沿用场景/镜头命名，同内容共享首个文件。保存提交后清理重复旧文件；撤销所需素材由.undo历史保护，不作为永久冗余。

## 项目封面与成片
canvas新增kind=cover-group（封面）和kind=video-group（成片视频）入口节点，作为script子节点。cover-group只连接图片asset，video-group只连接视频asset；不写入核心characters/shots/storyboards。每个项目默认各一个，程序兼容旧项目自动补建；已有入口的用户断线状态保留。图片沿用全局去重并优先角色命名，其余封面命名封面01等，成片视频命名成片01等。可通过侧栏导入/粘贴/拖入，画布同步节点及连接。

BGM：新增bgm-group作为script子节点，仅连接音频asset，音频使用assets/audio路径及原文件名。与cover-group/video-group统一位于右侧项目素材区，侧栏支持导入、粘贴、拖入及播放；不写入核心剧情结构。

画布坐标：所有节点均支持字符串 `autoPosition`；`"false"` 固定手动坐标，自动排布不可覆盖，`"true"` 允许后续自动排布。读取已保存 canvas 时完整保留坐标；旧节点缺失或空值按手动坐标处理。新建场景的显式插入避让仍可平移后续场景及其关联节点，并保留平移结果。

数据目录优先使用 CANVAS_DATA_DIR 绝对路径；未指定时复用程序目录或上级中的既有数据目录，全新桌面安装使用系统文档目录下的“剧本画布”。详见仓库 README。
