# 基于本人资料的假设与采集前设计

用户明确要求生成研究假设或实验协议时使用；只讨论方法、查看结果或参数不足时，不启动生成。

1. 核对本轮已选来源；没有来源时请用户选择，不用搜索摘要冒充本人证据。
2. 假设生成调用 generate_research_design(kind="hypothesis-generation", question=用户问题)。保留数字、适用范围、篇幅和证据限定，不将软件验收外推成科研结果。
3. 实验设计调用 generate_research_design(kind="experiment-design", question=用户问题, experiment=已明确的设计要素)。experiment必须有hypothesis、experimentalUnit、arms（至少处理/对照两组）、primaryOutcome、constraints、alpha、targetPower。只能使用用户明确给出的设计选择；不能从一般经验猜实验单位、对照、主要结局、alpha或power。缺少时在当前对话简短追问，或open_plugin打开原有实验设计表单，不声称已生成。
4. 每轮只尝试一次生成，不因失败或不满意自动重试。工具仅使用服务端核验的本轮来源、账号和文献本；不提供账号、路径、版本或模型配置。
5. 成功以工具的已保存版本为准；draft-saved必须说明证据检查未完成，错误/保存失败不能说成完成。结果挂在本轮卡片，刷新后按不可变版本恢复，不让后续结果替换旧卡片。
6. 假设必须区分依据、竞争解释、可证伪预测和验证路径。协议只做采集前计划，不能宣称实验执行、统计显著、因果、新颖性或伦理审批完成。证据编号可追溯不等于科学正确，关键判断需要定位原文核验。
