const messages: Record<string, string> = {
  provider_capability_unavailable: '当前自带密钥配置不支持此绘图或语音功能。百炼请补充业务空间 ID；其他文本服务请改选支持该能力的配置，或明确选择平台模型。',
  account_login_required: '请先登录账号。', commercial_acceptance_pending: '收费验收尚未完成，暂未开放购买。',
  confirmed_quote_required: '请先确认本次任务费用。', quote_already_consumed: '该任务已提交，请勿重复操作。', quote_expired: '报价已过期，请重新确认费用。',
  quote_payload_changed: '任务内容已修改，请重新确认费用。', quote_operation_or_source_mismatch: '任务或模型来源已修改，请重新报价。',
  insufficient_research_points: '科研点数不足，请购买点数或联系课题组管理员。', member_budget_exceeded: '本次任务超过成员月预算，请联系课题组管理员。',
  model_not_priced: '该模型尚未完成价格核验，暂不能用于收费任务。', operation_not_priced: '这项服务尚未完成成本核验，暂未开放收费使用。',
  paid_membership_required: '这项能力需要科研版及以上会员。', seat_limit_reached: '课题组席位已满，请先购买额外席位。',
  account_access_denied: '你没有该付款账户的权限。', account_not_accessible: '该付款账户不可访问，请重新选择。',
  notebook_limit_exceeded: '文献本数量已达到套餐上限，已有内容仍可查看和导出。', storage_capacity_exceeded: '附件容量已达到套餐上限，请整理资料或升级套餐。',
  active_plan_change_requires_prorated_upgrade: '当前套餐仍有效，跨套餐升级需要核算剩余服务期，请联系服务方处理。',
  previous_provider_usage_unverified: '上一个生成环节的用量尚未核验，已暂停继续调用。', resource_not_in_confirmed_quote: '这项模型资源不在已确认报价内，已停止调用。',
  confirmed_usage_limit_reached: '已达到本次授权用量上限，请重新确认后继续。', confirmed_image_limit_reached: '已达到本次授权图片数量上限。',
  verification_resend_too_soon: '请等待 60 秒后再发送验证码。', verification_email_delivery_failed: '验证码发送失败，请稍后重试。', verification_code_invalid_or_expired: '验证码错误或已过期，请重新获取。',
  alipay_not_configured: '支付宝收款暂未就绪，请稍后再试。', wechat_not_configured: '微信收款暂未就绪，请稍后再试。',
};
export function commerceMessage(code: string): string { return messages[code] || '会员或用量服务暂时不可用，请稍后重试。'; }
