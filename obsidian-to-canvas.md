# 从 Obsidian 提取剧本画布资料

按 [项目 Schema](canvas-project.schema.json) 与 [项目技能](canvas-project-json-skill/SKILL.md) 提取已确认的创作内容。不要直接复制整个数据库或知识库。

- project.title：剧本名；synopsis：剧情梗概；visualStyle：画风。
- characters：角色资料与真实存在的 JPG/PNG 设定图。
- shots：场景的 ID、名称、时间、时长和描述。
- storyboards：镜头的 ID、名称、提示词与图片；shotId 必须对应一个已存在的场景。
- canvas：节点与连线快照。第一次生成可使用空白模板，更新已有项目时保留其节点 ID、布局与关联。

导入层级：剧本 → 场景入口 → 场景 → 镜头 → 参考图/视频；角色、剧情梗概、画风、封面、成片视频和 BGM 是剧本下的相关分支。

JSON 不内嵌图片。使用项目内相对路径（例如 assets/characters/lead.png），不写绝对路径或 Obsidian 的嵌入语法。角色图仅 JPG/PNG；镜头图可使用 JPG/PNG/WebP/GIF。缺少素材时省略引用，不编造文件名。

使用稳定英文 ID，更新时保持现有 ID。保留可选的 project.codex 历史来源标记，默认不创建该标记。当前桌面程序不提供聊天或生成功能。

交付 JSON 及其 assets 子目录。省略无关的标签、属性、反向链接、日志及私密资料；不要在公开仓库里放入私人项目。
