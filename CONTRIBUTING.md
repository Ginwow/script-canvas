# 参与开发

使用 Node.js 22+，运行 npm ci 安装锁定依赖，npm test 执行隔离回归，npm run check:publish 检查公开文件清单，再用 npm start 验证界面。

请围绕一个问题提交修改，并描述复现步骤、最终行为和验证范围。涉及节点类型、字段、引用或导入合约时，同步更新根 Schema、canvas-project-json-skill/references/canvas-project.schema.json 和技能说明；两个 Schema 必须相同。

测试只能使用临时目录和合成数据，不能读取或修改开发者真实项目。不要提交剧本、私人素材、用户目录、密钥、缓存、打包产物或本地恢复日志。公开清单由 tools/publish-files.json 控制，新增源码时同步更新；Git 忽略规则默认拒绝未列出的文件。

替换正在使用的桌面程序之前，先通过应用的保存关闭流程正常退出，确认进程退出后再替换。不要强制终止程序以绕过保存。
