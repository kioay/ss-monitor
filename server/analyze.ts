import { negativeWords, positiveWords, topicLexicon } from "./config";
import { matchCurrentVersionTerms } from "./currentVersion";
import { ss1WeaponNames } from "./domainSafeTerms";
import { clamp, compactText, uniq } from "./utils";
import type { ContentPart, GameId, MonitorItem, RiskLevel, Sentiment } from "../src/shared";

interface AnalyzeInput {
  contentParts: ContentPart[];
  gameId: GameId;
  metrics: MonitorItem["metrics"];
  title: string;
}

interface SentimentProfile {
  score: number;
  authorScore: number;
  audienceScore: number;
  positive: number;
  negative: number;
  audienceMentions: number;
  skillShowcase: boolean;
}

interface ContextProfile {
  environmentInquiry: boolean;
  playerBehaviorComplaint: boolean;
  personalSkillShare: boolean;
  playerHelpRequest: boolean;
  routinePlayerShare: boolean;
  eventUnlockDiscussion: boolean;
}

const audiencePartTypes = new Set<ContentPart["type"]>(["comment", "danmaku", "post"]);
const authorPartTypes = new Set<ContentPart["type"]>(["title", "description", "subtitle"]);

const audiencePraiseWords = [
  "牛",
  "牛逼",
  "强强",
  "强啊",
  "厉害",
  "准",
  "好活",
  "高手",
  "大佬",
  "秀",
  "天秀",
  "帅",
  "带飞",
  "教学",
  "学到了",
  "享受",
  "爽"
];

const skillShowcaseWords = [
  "技术",
  "操作",
  "视角",
  "击杀",
  "击杀数",
  "单排",
  "四排",
  "五排",
  "五黑",
  "战队车",
  "碾碎",
  "全程无剪辑",
  "身法",
  "教程",
  "教学",
  "高光",
  "准",
  "高手",
  "主播",
  "巅王",
  "钻石"
];

const illegalCoreTermPattern = /(外挂|外卦|开挂|挂狗|作弊)/i;
const illegalToolTermPattern = /(内存宏|鼠标宏|压枪宏|自瞄|锁头|穿墙|无后座|无后坐|DMA|驱动挂|驱动级|过检测|免封)/i;
const illegalAmbiguousTermPattern = /(科技|辅助|脚本|透视|驱动)/i;
const illegalAnyTermPattern =
  /(外挂|外卦|开挂|挂狗|作弊|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|无后座|无后坐|DMA|驱动挂|驱动级|过检测|免封|科技|辅助|驱动)/i;
const illegalContextTermPattern =
  /(外挂|外卦|开挂|挂狗|作弊|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|无后座|无后坐|DMA|驱动挂|驱动级|过检测|免封|科技|辅助|驱动)/gi;
const illegalPromotionPattern =
  /(QQ群|群号|加群|进群|q群|qq|企鹅|微信|VX|vx|私信|主页|联系|购买|售卖|卖挂|卡密|代理|月卡|周卡|日卡|天卡|包天|包月|接单|体验群|交流群|发卡|下单|价格|收费|多少钱)/i;
const illegalCommercialPattern = /(购买|售卖|卖挂|卡密|代理|月卡|周卡|日卡|天卡|包天|包月|接单|发卡|下单|价格|收费|多少钱)/;
const illegalStrongDemoPattern = /(外挂演示|外卦演示|开挂演示|作弊演示|功能展示|效果展示|实测|测试效果|演示|展示|录屏|试用|试挂)/;
const illegalWeakDemoPattern = /(教程|教学|视频|第一视角|实战|全程|效果|测试)/;
const illegalGovernancePattern = /(封号|封禁|举报|反挂|外挂治理|封挂|官方检测|检测机制|检测系统|打击|制裁|处理|清理|禁赛)/;
const illegalComplaintPattern = /(泛滥|离谱|猖獗|满天飞|一堆|全是|太多|多到|遍地|横行|严重|恶心|破坏环境|影响公平|没人管|不管|管管|举报不动)/;
const illegalQuestionPattern = /(多吗|多不多|严重吗|还多吗|有没有|环境|现状|情况|咋样|怎么样|问一下|求问|[?？])/;
const legalAmbiguousTermPattern = /(辅助瞄准|瞄准辅助|辅助线|辅助设置|辅助功能|新手辅助|任务辅助|剧情脚本|脚本剧情|脚本杀|科技感|高科技|驱动程序|显卡驱动)/;
const illegalHighRiskToolWords = [
  "内存宏",
  "鼠标宏",
  "压枪宏",
  "自瞄",
  "锁头",
  "透视",
  "穿墙",
  "无后座",
  "无后坐",
  "DMA",
  "驱动挂",
  "驱动级",
  "过检测",
  "免封"
];
const tagListSeparatorPattern = /[,\n，、#|/]/g;
const skillTagContextPattern = /(集锦|高光|精彩操作|个人|玩家|UP主|主播|全局|第一视角|全程无剪辑|身法|击杀|连杀|排位|单排|四排|五排|操作|FPS)/;

export function analyzeItem(input: AnalyzeInput) {
  const content = input.contentParts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n");
  const signalContent = maskDomainSafeTerms(content, input.gameId);

  const topics = Object.entries(topicLexicon)
    .filter(([, words]) => words.some((word) => signalContent.includes(word)))
    .map(([topic]) => topic);
  const context = detectContext(signalContent);
  if (context.personalSkillShare) topics.unshift("个人技术分享");
  if (context.playerHelpRequest || context.eventUnlockDiscussion) topics.unshift("玩家求助咨询");
  if (context.routinePlayerShare) topics.unshift("玩家日常分享");
  if (context.playerBehaviorComplaint) topics.unshift("玩家行为争议");
  const currentVersionTerms =
    input.gameId === "ss1" ? uniq([...matchCurrentVersionTerms(content), ...matchCurrentVersionTerms(signalContent)]) : [];
  if (currentVersionTerms.length) topics.unshift("当前版本重点");

  const sentimentProfile = scoreSentiment(input.contentParts, input.gameId);
  const sentimentScore = sentimentProfile.score;
  const sentiment = labelSentiment(sentimentProfile, signalContent, context);
  const risk = assessRisk(signalContent, sentimentProfile, input.metrics, context, currentVersionTerms);
  if (!hasIllegalTopicContext(signalContent, risk.reasons)) removeTopic(topics, "外挂公平");
  else if (hasIllegalRiskReason(risk.reasons)) topics.unshift("外挂公平");
  const finalTopics = uniq(topics);
  const keywords = uniq([...currentVersionTerms, ...extractKeywords(signalContent, finalTopics, finalTopics.includes("外挂公平"))]);
  const summary = summarizeContent(input.title, input.contentParts, finalTopics, sentiment, sentimentProfile);

  return {
    topics: finalTopics.length ? finalTopics : ["综合讨论"],
    sentiment,
    sentimentScore,
    keywords,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    summary
  };
}

function scoreSentiment(parts: ContentPart[], gameId: GameId): SentimentProfile {
  const content = parts.map((part) => part.text).join("\n");
  let positive = 0;
  let negative = 0;
  let authorPositive = 0;
  let authorNegative = 0;
  let audiencePositive = 0;
  let audienceNegative = 0;
  let audienceMentions = 0;

  for (const part of parts) {
    if (!part.text) continue;
    const weight = partWeight(part.type);
    const signal = scoreTextSignals(part.text, gameId);
    positive += signal.positive * weight;
    negative += signal.negative * weight;

    if (audiencePartTypes.has(part.type)) {
      audienceMentions += 1;
      audiencePositive += signal.positive;
      audienceNegative += signal.negative;
    } else if (authorPartTypes.has(part.type)) {
      authorPositive += signal.positive;
      authorNegative += signal.negative;
    }
  }

  const audienceScore = normalizedScore(audiencePositive, audienceNegative);
  const authorScore = normalizedScore(authorPositive, authorNegative);
  const skillShowcase = isSkillShowcase(content);

  if (skillShowcase && audienceScore >= -0.15) {
    positive += 0.8;
    negative *= 0.82;
  }

  return {
    score: normalizedScore(positive, negative),
    authorScore,
    audienceScore,
    positive,
    negative,
    audienceMentions,
    skillShowcase
  };
}

function scoreTextSignals(content: string, gameId: GameId) {
  const signalContent = maskDomainSafeTerms(content, gameId);
  let positive = 0;
  let negative = 0;

  for (const word of uniq([...positiveWords, ...audiencePraiseWords])) {
    const signal = countPositiveSignalOccurrences(signalContent, word);
    positive += signal.positive;
    negative += signal.negated;
  }

  for (const word of negativeWords) {
    negative += countOccurrences(signalContent, word);
  }

  if ((signalContent.includes("？") || signalContent.includes("?")) && negative > positive) negative += 0.2;
  if ((signalContent.includes("！！") || signalContent.includes("!!")) && negative > positive) negative += 0.2;

  return { positive, negative };
}

function normalizedScore(positive: number, negative: number) {
  const total = positive + negative;
  if (!total) return 0;
  return clamp((positive - negative) / Math.max(2, total), -1, 1);
}

function labelSentiment(profile: SentimentProfile, content: string, context: ContextProfile): Sentiment {
  const hasPositive = positiveWords.some((word) => content.includes(word));
  const hasNegative = negativeWords.some((word) => content.includes(word));
  if (profile.audienceMentions >= 3 && profile.audienceScore > 0.15 && profile.score > -0.35) return "positive";
  if (profile.audienceMentions >= 3 && profile.audienceScore < -0.25 && profile.score < 0.2) return "negative";
  if (isProtectedDiscussionContext(context) && !isStrongComplaint(content)) return hasPositive && hasNegative ? "mixed" : "neutral";
  if (profile.skillShowcase && profile.score > -0.35 && profile.audienceScore > -0.2) {
    return profile.score > 0.16 || profile.audienceScore > 0.08 ? "positive" : "neutral";
  }
  if (isLowContextCheatMention(content, profile)) return "neutral";
  if (hasPositive && hasNegative && Math.abs(profile.score) < 0.25) return "mixed";
  if (profile.score > 0.18) return "positive";
  if (profile.score < -0.18) return "negative";
  return "neutral";
}

function extractKeywords(content: string, topics: string[], includeIllegalKeywords = true) {
  const domainWords = uniq(Object.values(topicLexicon).flat());
  const illegalWords = new Set(topicLexicon.外挂公平 || []);
  const matched = domainWords.filter((word) => content.includes(word) && (includeIllegalKeywords || !illegalWords.has(word)));
  const english = content.match(/[A-Za-z][A-Za-z0-9+-]{1,12}/g) || [];
  const numbers = content.match(/\d{1,4}(?:\.\d+)?(?:月|日|版本|战力|元)?/g) || [];

  return uniq([...topics, ...matched, ...english, ...numbers])
    .filter((word) => word.length > 1)
    .slice(0, 10);
}

function hasIllegalRiskReason(reasons: string[]) {
  return reasons.some((reason) => reason.includes("外挂"));
}

function hasIllegalTopicContext(content: string, reasons: string[]) {
  if (hasIllegalRiskReason(reasons)) return true;
  const windows = illegalContextWindows(content);
  return (
    hasCheatPromotionContext(windows) ||
    hasCheatDemoContext(windows) ||
    hasHighRiskToolContext(windows) ||
    hasCheatGovernanceContext(windows) ||
    hasCheatQuestionContext(windows)
  );
}

function removeTopic(topics: string[], topic: string) {
  let index = topics.indexOf(topic);
  while (index >= 0) {
    topics.splice(index, 1);
    index = topics.indexOf(topic);
  }
}

function assessRisk(
  content: string,
  sentimentProfile: SentimentProfile,
  metrics: MonitorItem["metrics"],
  context: ContextProfile,
  currentVersionTerms: string[] = []
) {
  const sentimentScore = sentimentProfile.score;
  const illegalRisk = detectIllegalBehavior(content, context);
  const engagement =
    (metrics.views || 0) * 0.002 +
    (metrics.replies || 0) * 2 +
    (metrics.comments || 0) * 2 +
    (metrics.danmaku || 0) * 1.2 +
    (metrics.likes || 0) * 0.2 +
    (metrics.shares || 0) * 0.4;

  const primaryReasons: string[] = [];
  primaryReasons.push(...illegalRisk.reasons);
  const audienceDefused = sentimentProfile.audienceMentions >= 3 && sentimentProfile.audienceScore > 0.12 && sentimentScore > -0.35;
  const skillDefused = sentimentProfile.skillShowcase && sentimentProfile.audienceScore > -0.15 && sentimentScore > -0.35;
  const contextDefused = isProtectedDiscussionContext(context);
  const isolatedCheatMention = isIsolatedCheatMention(content, sentimentProfile, illegalRisk);
  const illegalRiskOnly = illegalRisk.level === "high" && !isStrongComplaint(content) && !illegalComplaintPattern.test(content) && !isOfficialImpactComplaint(content);
  const negativeSignal = sentimentScore < -0.35 && !audienceDefused && !skillDefused && !contextDefused && !isolatedCheatMention && !illegalRiskOnly;
  const officialImpactSignal = isOfficialImpactComplaint(content);
  const sensitiveSignal =
    hasContextualSensitiveSignal(content, sentimentProfile, officialImpactSignal) &&
    !illegalRisk.reasons.length &&
    !audienceDefused &&
    !skillDefused &&
    !contextDefused &&
    !isolatedCheatMention;
  const governanceSignal = /(水军|诈骗|未成年|退款|投诉)/.test(content);
  const versionSignal = currentVersionTerms.length > 0 && (sentimentScore < -0.18 || isCurrentVersionComplaint(content));
  const highEngagementSignal = engagement > 800;
  const elevatedEngagementSignal = engagement > 250;

  if (negativeSignal) {
    primaryReasons.push("负面表达集中");
  }
  if (sensitiveSignal) {
    primaryReasons.push("命中敏感风险词");
  }
  if (governanceSignal) {
    primaryReasons.push("命中治理类风险词");
  }
  if (versionSignal) {
    primaryReasons.push("当前版本重点负反馈");
  }

  const semanticSignals = [
    negativeSignal,
    sensitiveSignal,
    governanceSignal,
    versionSignal,
    officialImpactSignal,
    highEngagementSignal
  ].filter(Boolean).length;
  let level: RiskLevel = "low";
  if (
    illegalRisk.level === "high" ||
    (!contextDefused &&
      (semanticSignals >= 3 ||
        (negativeSignal && elevatedEngagementSignal && (officialImpactSignal || versionSignal || sensitiveSignal || governanceSignal))))
  ) {
    level = "high";
  } else if (
    (illegalRisk.level === "medium" && !context.personalSkillShare) ||
    primaryReasons.length === 1 ||
    (!contextDefused && negativeSignal)
  ) {
    level = "medium";
  }
  if (context.environmentInquiry && illegalRisk.level !== "high" && level === "high") level = "medium";

  const reasons = [...primaryReasons];
  if (context.environmentInquiry && illegalRisk.level !== "high" && level !== "low") reasons.push("回游/环境询问语境");
  if (level !== "low" && engagement > 800) reasons.push("互动量较高");

  return { level, reasons: uniq(reasons).slice(0, 4) };
}

function summarizeContent(title: string, parts: ContentPart[], topics: string[], sentiment: Sentiment, sentimentProfile: SentimentProfile) {
  const comments = parts.filter((part) => part.type === "comment" || part.type === "danmaku" || part.type === "post");
  const base = compactText(
    [
      title,
      ...parts.filter((part) => part.type === "description" || part.type === "tag").map((part) => part.text),
      ...comments.slice(0, 5).map((part) => part.text)
    ].map(maskContactInfo),
    220
  );
  const topicText = topics.length ? `主题集中在${topics.slice(0, 3).join("、")}` : "主题暂不集中";
  const sentimentText =
    sentiment === "negative" ? "负面倾向明显" : sentiment === "positive" ? "正面反馈较多" : sentiment === "mixed" ? "正负反馈混合" : "情绪相对中性";
  const audienceText =
    sentimentProfile.audienceMentions >= 3
      ? sentimentProfile.audienceScore > 0.15
        ? "，评论/回复偏正面"
        : sentimentProfile.audienceScore < -0.25
          ? "，评论/回复偏负面"
          : "，评论/回复分歧不大"
      : "";

  return `${topicText}，${sentimentText}${audienceText}。${base}`;
}

function countOccurrences(content: string, word: string) {
  if (!word) return 0;
  return content.split(word).length - 1;
}

function countPositiveSignalOccurrences(content: string, word: string) {
  if (!word) return { positive: 0, negated: 0 };
  let positive = 0;
  let negated = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(word, cursor);
    if (index < 0) break;
    const prefix = content.slice(Math.max(0, index - 4), index);
    const suffix = content.slice(index + word.length, index + word.length + 4);
    if (isFalsePositivePraiseContext(prefix, suffix, word)) {
      cursor = index + word.length;
      continue;
    }
    if (isNeutralPositiveQuestion(prefix, word)) {
      cursor = index + word.length;
      continue;
    }
    if (!word.startsWith("不") && /不|没|無|无|难/.test(prefix)) negated += 1;
    else positive += 1;
    cursor = index + word.length;
  }
  return { positive, negated };
}

function isNeutralPositiveQuestion(prefix: string, word: string) {
  if (word !== "可以" && word !== "好玩" && word !== "值得") return false;
  return /(是不是|是否|能不能|可不可以|要不要|该不该|值不值)$/.test(prefix);
}

function isFalsePositivePraiseContext(prefix: string, suffix: string, word: string) {
  if (word === "强") {
    if (/(加|增|变|削)$/.test(prefix)) return true;
    if (/^(行|制|迫|绑|开|化|度|调|求)/.test(suffix)) return true;
  }
  if (word === "爽" && /^(约|文|局)/.test(suffix)) return true;
  return false;
}

function partWeight(type: ContentPart["type"]) {
  if (type === "comment" || type === "post") return 1.45;
  if (type === "danmaku") return 1.15;
  if (type === "title") return 1;
  if (type === "description" || type === "subtitle") return 0.85;
  return 0.35;
}

function isSkillShowcase(content: string) {
  return skillShowcaseWords.some((word) => content.includes(word));
}

function maskDomainSafeTerms(content: string, gameId: GameId) {
  let masked = content
    .replaceAll("@无端科技", "官方账号")
    .replaceAll("无端科技", "厂商名称");
  if (gameId === "ss1") {
    for (const term of ss1WeaponNames) {
      masked = masked.replaceAll(term, "武器名");
    }
  }
  return masked;
}

function isEnvironmentInquiry(content: string) {
  const explicitQuestion = /[?？]|吗|么|咋样|怎样|怎么样|如何|好不好|能不能|能玩吗|还能玩|值得|求问|请问|问下|问一下|有没有必要/.test(content);
  const returnIntent = /回游|回坑|回归|想玩|准备玩|入坑|萌新|新手|游戏荒|荒了/.test(content);
  const environmentTopic = /环境|游戏环境|现状|生态|人多|人少|匹配|排位|服务器|还能玩|好玩/.test(content);
  const cheatEnvironmentQuestion = /(外挂|外卦|挂|科技|辅助|封号|封禁).{0,10}(多吗|多不多|严重吗|还多吗|有没有|环境|现状|情况|咋样|怎么样|[?？])/.test(content);
  const strongComplaint =
    isStrongComplaint(content) ||
    /(外挂|外卦|挂|科技|辅助).{0,12}(泛滥|离谱|猖獗|满天飞|一堆|全是|太多|多到|遍地)/.test(content);
  if (strongComplaint && !returnIntent) return false;
  return (returnIntent && (environmentTopic || explicitQuestion || cheatEnvironmentQuestion)) || (environmentTopic && explicitQuestion) || cheatEnvironmentQuestion;
}

function detectContext(content: string): ContextProfile {
  return {
    environmentInquiry: isEnvironmentInquiry(content),
    playerBehaviorComplaint: isPlayerBehaviorComplaint(content),
    personalSkillShare: isPersonalSkillShare(content),
    playerHelpRequest: isPlayerHelpRequest(content),
    routinePlayerShare: isRoutinePlayerShare(content),
    eventUnlockDiscussion: isEventUnlockDiscussion(content)
  };
}

function isProtectedDiscussionContext(context: ContextProfile) {
  return (
    context.environmentInquiry ||
    context.playerBehaviorComplaint ||
    context.personalSkillShare ||
    context.playerHelpRequest ||
    context.routinePlayerShare ||
    context.eventUnlockDiscussion
  );
}

function isStrongComplaint(content: string) {
  return /(垃圾|破游戏|恶心|烂透|没救|倒闭|炸服|闪退|崩溃|白氪|骗氪|退钱|退款|投诉)/.test(content);
}

function isOfficialImpactComplaint(content: string) {
  const officialTarget = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|礼包|礼盒|皮肤|匹配|服务器|交易行|优化|BUG|bug|卡顿|炸服|闪退|封号|封禁|退款|投诉)/;
  const complaint = /(垃圾|破游戏|恶心|烂透|没救|倒闭|白氪|骗氪|逼氪|太贵|退钱|退款|投诉|不修|不管|不开|不开放|卡顿|炸服|闪退|崩溃|异常|问题|离谱|削弱|太弱|难用)/;
  return officialTarget.test(content) && complaint.test(content);
}

function isPlayerBehaviorComplaint(content: string) {
  const playerTarget = /(别人|他们|他人|队友|对手|玩家|路人|队伍|房主|敌人|人机|小学生|挂狗|老六|堵人|卡门|卡点|抢武器|扔.{0,4}武器|捡.{0,4}武器|坑人|摆烂|送人头|恶意|报复)/;
  const conflictAction = /(堵人|卡门|卡点|抢武器|扔.{0,4}武器|捡.{0,4}武器|坑人|摆烂|送人头|报复|恶心.{0,8}(别人|他们|他人|队友|对手|玩家)|怎么.{0,8}(恶心|报复).{0,8}(别人|他们|他人|队友|对手|玩家))/;
  const officialTarget = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|礼包|皮肤|匹配|服务器|炸服|闪退|BUG|bug|卡顿|封号|封禁|举报|外挂|外卦|科技|辅助)/;
  const strongOfficialComplaint = /(破游戏|垃圾游戏|倒闭|没救|白氪|骗氪|退钱|退款|投诉)/;
  return playerTarget.test(content) && conflictAction.test(content) && !officialTarget.test(content) && !strongOfficialComplaint.test(content);
}

function isPersonalSkillShare(content: string) {
  const skillContext =
    /(个人|玩家|UP主|主播|全局|整局|全程|第一视角|视角|集锦|高光|精彩|操作|技术|身法|击杀|连杀|对局|实战|教学|教程|讲解|思路|打法|复盘|单排|四排|五排|排位)/;
  const shareAction = /(分享|合集|集锦|高光|精彩操作|第一视角|全局游戏|全程无剪辑|思路讲解|教学|教程|讲解|打法|复盘|实战|单排|四排|五排|带飞)/;
  const officialComplaint = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|骗氪|退款|投诉|服务器|炸服|闪退|BUG|bug|卡顿|倒闭|没救|破游戏|垃圾游戏)/;
  const illegalSignal = /(外挂|外卦|开挂|挂狗|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|DMA|过检测|免封|QQ群|群号|加群|售卖|卡密)/;
  return skillContext.test(content) && shareAction.test(content) && !officialComplaint.test(content) && !illegalSignal.test(content);
}

function isPlayerHelpRequest(content: string) {
  const helpIntent = /(求|请问|问下|问一下|有没有|有无|知道|告知|大佬|大神|专家|萌新|新手|怎么|咋|如何|多少|能不能|要不要|该不该|值不值|建议|攻略|解答|科普)/;
  const helpTopic =
    /(倍率|伤害|穿透|能穿|怎么穿|多少钱|多少能|多少级|多少战力|价格|抽|保底|概率|玩法|模式|决斗场|武器|皮肤|角色|配件|技能|配置|设置|灵敏度|键位|任务|活动|兑换|获取|入坑|回坑|回游|怎么玩|怎么打|怎么提高|怎么提升)/;
  const questionMark = /[?？]/;
  const officialComplaint = /(官方|策划|运营|客服|公告|骗氪|退款|投诉|倒闭|没救|破游戏|垃圾游戏|炸服|闪退|BUG|bug|卡顿)/;
  const illegalSignal = /(外挂|外卦|开挂|挂狗|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|DMA|过检测|免封|QQ群|群号|加群|售卖|卡密)/;
  return helpIntent.test(content) && (helpTopic.test(content) || questionMark.test(content)) && !officialComplaint.test(content) && !illegalSignal.test(content);
}

function isEventUnlockDiscussion(content: string) {
  const itemContext = /(礼盒|礼包|活动|绝版|开放|交易|武器|道具|龙魂箭|bug箭|BUG箭)/;
  const unlockContext = /(强开|强行|翘开|封号|封七天|封了|不开|不开放|什么时候|什么原因|上次开放)/;
  const illegalSignal = /(外挂|外卦|开挂|挂狗|作弊|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|DMA|过检测|免封|QQ群|群号|加群|售卖|卡密)/;
  return itemContext.test(content) && unlockContext.test(content) && !illegalSignal.test(content);
}

function isRoutinePlayerShare(content: string) {
  const shareAction = /(获得|获取|买到|购买|入手|抽到|抽取|出了|开出|晒|分享|记录)/;
  const shareObject = /(武器|皮肤|道具|角色|配件|金蛇|桃光|裁决之音|号|账号|礼包|奖励|战绩|段位|排位|击杀|截图)/;
  const officialComplaint = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|骗氪|退款|投诉|概率|保底|太贵|降价|倒闭|没救|破游戏|垃圾游戏|炸服|闪退|BUG|bug|卡顿)/;
  const illegalSignal = /(外挂|外卦|开挂|挂狗|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|DMA|过检测|免封|QQ群|群号|加群|售卖|卡密)/;
  return shareAction.test(content) && shareObject.test(content) && !officialComplaint.test(content) && !illegalSignal.test(content);
}

function isCurrentVersionComplaint(content: string) {
  return /(太弱|弱了|削弱|手感.{0,6}差|很差|没用|不好用|难用|垃圾|恶心|离谱|问题|bug|BUG|卡顿|异常|不生效)/.test(content);
}

function hasContextualSensitiveSignal(content: string, sentimentProfile: SentimentProfile, officialImpactSignal: boolean) {
  const strongSensitive = /(倒闭|破游戏|没救|白氪|骗氪|炸服|闪退|崩溃)/.test(content);
  if (strongSensitive) return officialImpactSignal || isStrongComplaint(content) || sentimentProfile.score < -0.15;

  const issueMatches = content.match(/BUG|bug|卡顿|掉帧|延迟|掉线|异常|卡死|用不了|打不开|进不去/g)?.length || 0;
  if (!issueMatches) return false;
  const issueComplaint =
    /(BUG|bug|卡顿|掉帧|延迟|掉线|异常).{0,12}(严重|离谱|一直|频繁|用不了|打不开|进不去|修|不修|影响|卡死|崩|炸|难受)/.test(content) ||
    /(用不了|打不开|进不去|卡死|修|不修).{0,12}(BUG|bug|问题|卡顿|掉帧|延迟|掉线|异常)/.test(content);

  return officialImpactSignal || (issueMatches >= 2 && sentimentProfile.score < -0.15) || (issueComplaint && sentimentProfile.score < -0.2);
}

function detectIllegalBehavior(content: string, context: ContextProfile): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: RiskLevel = "low";
  const windows = illegalContextWindows(content);
  if (!windows.length) return { level, reasons };

  function addReason(reason: string, nextLevel: RiskLevel) {
    reasons.push(reason);
    if (nextLevel === "high") level = "high";
    else if (level !== "high") level = "medium";
  }

  if (hasCheatPromotionContext(windows)) addReason("疑似外挂宣传引流", "high");
  if (hasCheatDemoContext(windows)) addReason("疑似外挂演示内容", "high");
  if (hasHighRiskToolContext(windows)) addReason("命中外挂/脚本高危词", "high");
  if (hasCheatGovernanceContext(windows) || (context.environmentInquiry && hasCheatQuestionContext(windows))) {
    addReason("命中外挂治理线索", "medium");
  }

  return { level, reasons };
}

function illegalContextWindows(content: string) {
  const windows: Array<{ term: string; text: string }> = [];
  illegalContextTermPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = illegalContextTermPattern.exec(content))) {
    const term = match[0];
    const lineStart = content.lastIndexOf("\n", Math.max(0, match.index - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", match.index + term.length);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : content.length;
    const start = Math.max(lineStart, match.index - 32);
    const end = Math.min(lineEnd, match.index + term.length + 32);
    windows.push({ term, text: content.slice(start, end) });
    if (illegalContextTermPattern.lastIndex === match.index) illegalContextTermPattern.lastIndex += 1;
  }
  illegalContextTermPattern.lastIndex = 0;
  return windows;
}

function hasCheatPromotionContext(windows: Array<{ text: string }>) {
  return windows.some(({ text }) => {
    if (!illegalPromotionPattern.test(text)) return false;
    if (hasStrongIllegalAnchor(text)) return true;
    return illegalAmbiguousTermPattern.test(text) && !legalAmbiguousTermPattern.test(text);
  });
}

function hasCheatDemoContext(windows: Array<{ text: string }>) {
  return windows.some(({ text }) => {
    if (isLikelyTagOnlyContext(text)) return false;
    if (!hasStrongIllegalAnchor(text) && !hasMultipleHighRiskToolTerms(text)) return false;
    if (illegalStrongDemoPattern.test(text)) return true;
    return illegalWeakDemoPattern.test(text) && (illegalToolTermPattern.test(text) || /功能|效果|测试|试用|试挂/.test(text));
  });
}

function hasHighRiskToolContext(windows: Array<{ text: string }>) {
  return windows.some(({ text }) => {
    if (isLikelyTagOnlyContext(text)) return false;
    if (legalAmbiguousTermPattern.test(text)) return false;
    if (/(辅助|外挂|外卦|科技).{0,6}(售卖|卖挂|卡密|月卡|周卡|日卡|天卡|包天|包月|过检测|免封)/.test(text)) return true;
    if (/(售卖|卖挂|卡密|月卡|周卡|日卡|天卡|包天|包月|过检测|免封).{0,6}(辅助|外挂|外卦|科技)/.test(text)) return true;
    return hasMultipleHighRiskToolTerms(text);
  });
}

function hasCheatGovernanceContext(windows: Array<{ text: string }>) {
  return windows.some(({ text }) => {
    if (!illegalGovernancePattern.test(text) && !illegalComplaintPattern.test(text)) return false;
    if (hasStrongIllegalAnchor(text)) return true;
    return illegalAmbiguousTermPattern.test(text) && !legalAmbiguousTermPattern.test(text) && illegalCommercialPattern.test(text);
  });
}

function hasCheatQuestionContext(windows: Array<{ text: string }>) {
  return windows.some(({ text }) => hasStrongIllegalAnchor(text) && illegalQuestionPattern.test(text));
}

function hasStrongIllegalAnchor(text: string) {
  return illegalCoreTermPattern.test(text) || illegalToolTermPattern.test(text);
}

function hasAnyIllegalTerm(text: string) {
  return illegalAnyTermPattern.test(text);
}

function hasMultipleHighRiskToolTerms(text: string) {
  const matched = illegalHighRiskToolWords.filter((word) => text.includes(word));
  return uniq(matched).length >= 2;
}

function isLikelyTagOnlyContext(text: string) {
  const separatorCount = text.match(tagListSeparatorPattern)?.length || 0;
  return separatorCount >= 3 && skillTagContextPattern.test(text) && !illegalCommercialPattern.test(text) && !illegalGovernancePattern.test(text) && !illegalComplaintPattern.test(text);
}

function isIsolatedCheatMention(
  content: string,
  sentimentProfile: SentimentProfile,
  illegalRisk: { level: RiskLevel; reasons: string[] }
) {
  return (
    !illegalRisk.reasons.length &&
    hasAnyIllegalTerm(content) &&
    sentimentProfile.negative <= 1.6 &&
    !isStrongComplaint(content) &&
    !illegalGovernancePattern.test(content) &&
    !illegalComplaintPattern.test(content)
  );
}

function isLowContextCheatMention(content: string, sentimentProfile: SentimentProfile) {
  return (
    hasAnyIllegalTerm(content) &&
    sentimentProfile.negative <= 1.6 &&
    !isStrongComplaint(content) &&
    !illegalPromotionPattern.test(content) &&
    !illegalCommercialPattern.test(content) &&
    !illegalStrongDemoPattern.test(content) &&
    !illegalGovernancePattern.test(content) &&
    !illegalComplaintPattern.test(content)
  );
}

function maskContactInfo(text: string) {
  return text
    .replace(/(QQ群|群号|QQ|qq|q群|企鹅|微信|VX|vx)[:：\s-]*[A-Za-z0-9_-]{5,16}/g, "$1[已隐藏]")
    .replace(/(加群|进群|私信|联系|购买|售卖|卡密|代理).{0,8}(\d{5,12})/g, "$1[已隐藏]");
}
