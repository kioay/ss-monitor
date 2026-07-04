import { negativeWords, positiveWords, topicLexicon } from "./config";
import { matchCurrentVersionTerms } from "./currentVersion";
import { ss1WeaponNames } from "./domainSafeTerms";
import { clamp, compactText, uniq } from "./utils";
import { currentAnalysisVersion, type ContentPart, type GameId, type MonitorItem, type RiskLevel, type Sentiment } from "../src/shared";

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
  accountServerInquiry: boolean;
  playerBehaviorComplaint: boolean;
  personalSkillShare: boolean;
  playerHelpRequest: boolean;
  routinePlayerShare: boolean;
  eventUnlockDiscussion: boolean;
  eventPromotion: boolean;
  pcHardwarePriceDiscussion: boolean;
  ss2OfficialReputationComplaint: boolean;
}

export const analysisRulesVersion = currentAnalysisVersion;

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
const denseNegativeFeedbackWords = [
  "垃圾",
  "破游戏",
  "难受",
  "倒闭",
  "退坑",
  "白氪",
  "骗氪",
  "逼氪",
  "太贵",
  "恶心",
  "坨屎",
  "一坨",
  "暴毙",
  "背刺",
  "强行绑定",
  "烂",
  "削弱",
  "没人玩",
  "没有人玩",
  "排不到人",
  "都不玩",
  "难看",
  "不值",
  "氪再多也没用",
  "敷衍",
  "低配",
  "不敢想象",
  "不好玩",
  "挂狗",
  "宏孩儿",
  "踹人",
  "人机局",
  "比不了",
  "太牢",
  "很牢",
  "牢的",
  "没救",
  "不好用",
  "难用"
];
const weakDenseNegativeFeedbackWords = ["没人", "排不到", "一般般", "没用", "不好", "不正常", "有问题", "对不上"];
const negatableIllegalTerms = new Set([
  "外挂",
  "外卦",
  "开挂",
  "挂狗",
  "作弊",
  "科技",
  "辅助",
  "内存宏",
  "鼠标宏",
  "压枪宏",
  "脚本",
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
  "免封",
  "驱动"
]);

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
  if (context.accountServerInquiry) topics.unshift("账号/区服询问");
  if (context.personalSkillShare) topics.unshift("个人技术分享");
  if (context.playerHelpRequest || context.eventUnlockDiscussion) topics.unshift("玩家求助咨询");
  if (context.eventPromotion) topics.unshift("活动/赛事预告");
  if (context.pcHardwarePriceDiscussion) topics.unshift("电脑硬件价格讨论");
  if (context.ss2OfficialReputationComplaint) topics.unshift("官方口碑");
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
    analysisVersion: analysisRulesVersion,
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
    negative += countNegativeSignalOccurrences(signalContent, word);
  }
  if (gameId === "ss2" && isSs2OfficialReputationComplaint(signalContent)) {
    negative += 2;
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
  const hasNegative = negativeWords.some((word) => countNegativeSignalOccurrences(content, word) > 0);
  const denseNegative = hasDenseNegativeDiscussion(content, profile);
  if (denseNegative && profile.score < 0.35) {
    return profile.score < -0.12 || profile.audienceScore < -0.18 ? "negative" : "mixed";
  }
  if (profile.audienceMentions >= 3 && profile.audienceScore > 0.15 && profile.score > -0.35 && !denseNegative) return "positive";
  if (context.eventPromotion && !isStrongComplaint(content) && !isOfficialImpactComplaint(content) && !denseNegative) {
    return hasPositive && hasNegative ? "mixed" : "neutral";
  }
  if (context.ss2OfficialReputationComplaint && profile.score < 0.25) return "negative";
  if (profile.audienceMentions >= 3 && profile.audienceScore < -0.25 && profile.score < 0.2) return "negative";
  if (isProtectedDiscussionContext(context) && !isStrongComplaint(content) && !denseNegative) return hasPositive && hasNegative ? "mixed" : "neutral";
  if (profile.skillShowcase && profile.score > -0.35 && profile.audienceScore > -0.2) {
    return profile.score > 0.16 || profile.audienceScore > 0.08 ? "positive" : "neutral";
  }
  if (isLowContextCheatMention(content, profile)) return "neutral";
  if (hasPositive && hasNegative && Math.abs(profile.score) < 0.25) return "mixed";
  if (profile.score > 0.18) return "positive";
  if (profile.score < -0.18) return "negative";
  return "neutral";
}

function hasDenseNegativeDiscussion(content: string, profile: SentimentProfile) {
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matchedTerms = new Set<string>();
  const negativeLines = new Set<string>();
  const strongNegativeLines = new Set<string>();
  let weakHits = 0;

  for (const line of lines) {
    const strongMatches = denseNegativeFeedbackWords.filter((word) => line.includes(word) && !isNeutralNegativeContext(line, word));
    const weakMatches = weakDenseNegativeFeedbackWords.filter((word) => line.includes(word) && !isNeutralNegativeContext(line, word));
    if (!strongMatches.length && !weakMatches.length) continue;

    for (const word of strongMatches) matchedTerms.add(word);
    for (const word of weakMatches) matchedTerms.add(word);
    weakHits += weakMatches.length;
    negativeLines.add(line);
    if (strongMatches.length) strongNegativeLines.add(line);
  }

  const distinctTerms = matchedTerms.size;
  const negativeLineCount = negativeLines.size;
  const strongLineCount = strongNegativeLines.size;
  const audienceNegative = profile.audienceMentions >= 3 && profile.audienceScore <= -0.18;
  const scoreAllowsDenseSignal = profile.score < 0.35 && profile.audienceScore < 0.12;

  if (negativeLineCount >= 3 && distinctTerms >= 2 && scoreAllowsDenseSignal) return true;
  if (strongLineCount >= 2 && distinctTerms >= 2 && profile.score < 0.35) return true;
  if (audienceNegative && negativeLineCount >= 2 && distinctTerms >= 2 && profile.score < 0.25) return true;
  if (profile.score <= -0.35 && negativeLineCount >= 2 && (distinctTerms >= 2 || weakHits >= 2)) return true;
  return false;
}

function isNeutralNegativeContext(line: string, word: string) {
  if ((word === "没人玩" || word === "没有人玩") && /(还有没人玩|有没有人玩|还有人玩吗|有人玩吗|没人玩吗|没有人玩吗)/.test(line)) return true;
  if (word === "没人" && /没人(知道|懂|说|回复|回答|回|帮|解答|理|看)/.test(line)) return true;
  if (word === "没用" && /(没用过|有没有用|有用没用|能不能用|能用吗|好用吗)/.test(line)) return true;
  if ((word === "不好" || word === "不好玩" || word === "不好用") && /(好不好|是不是不好|哪里不好|有什么不好|好用吗|好玩吗)/.test(line)) return true;
  if (word === "有问题" && /(有问题吗|有没有问题|啥问题|什么问题|哪里有问题|问个问题)/.test(line)) return true;
  if (word === "不值" && /(值不值|值不值得|不值吗|值得吗)/.test(line)) return true;
  if (word === "排不到" && /(怎么排|排不到吗|会不会排不到)/.test(line)) return true;
  return false;
}

function isNegatedIllegalTermContext(line: string, term: string, indexInLine: number) {
  if (!negatableIllegalTerms.has(term)) return false;
  const prefix = line.slice(Math.max(0, indexInLine - 12), indexInLine);
  return /(?:不是|并非|没有|没用|没开|不会|不用|不带|不开|不打|不玩|不靠|不碰|不搞|不接|不卖|不使用|拒绝|杜绝|禁止|纯手动|绿色|正规|正常|干净|清白|绝不|从不|不|没|无|非)$/.test(prefix);
}

function hasNonNegatedPatternMatch(content: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content))) {
    const term = match[0];
    const lineStart = content.lastIndexOf("\n", Math.max(0, match.index - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", match.index + term.length);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : content.length;
    const line = content.slice(lineStart, lineEnd);
    if (!isNegatedIllegalTermContext(line, term, match.index - lineStart)) return true;
    if (matcher.lastIndex === match.index) matcher.lastIndex += 1;
  }
  return false;
}

function hasNonNegatedLiteralTerm(content: string, term: string) {
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(term, cursor);
    if (index < 0) return false;
    const lineStart = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", index + term.length);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : content.length;
    const line = content.slice(lineStart, lineEnd);
    if (!isNegatedIllegalTermContext(line, term, index - lineStart)) return true;
    cursor = index + term.length;
  }
  return false;
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
  const denseNegativeSignal = hasDenseNegativeDiscussion(content, sentimentProfile);
  const officialImpactSignal = isOfficialImpactComplaint(content);
  const currentVersionComplaint = isCurrentVersionComplaint(content);
  const denseNegativeBreaksProtection =
    denseNegativeSignal &&
    !context.playerBehaviorComplaint &&
    !(context.playerHelpRequest && !officialImpactSignal) &&
    !(context.routinePlayerShare && !officialImpactSignal) &&
    !(context.personalSkillShare && !officialImpactSignal && sentimentProfile.audienceScore > -0.32) &&
    !(context.eventUnlockDiscussion && !officialImpactSignal && !currentVersionComplaint) &&
    !(context.eventPromotion && !officialImpactSignal && !currentVersionComplaint) &&
    !(context.pcHardwarePriceDiscussion && !officialImpactSignal && !currentVersionComplaint);
  const audienceDefused = sentimentProfile.audienceMentions >= 3 && sentimentProfile.audienceScore > 0.12 && sentimentScore > -0.35 && !denseNegativeBreaksProtection;
  const skillDefused = sentimentProfile.skillShowcase && sentimentProfile.audienceScore > -0.15 && sentimentScore > -0.35 && !denseNegativeBreaksProtection;
  const contextDefused = isProtectedDiscussionContext(context) && !denseNegativeBreaksProtection;
  const isolatedCheatMention = isIsolatedCheatMention(content, sentimentProfile, illegalRisk);
  const illegalRiskOnly = illegalRisk.level === "high" && !isStrongComplaint(content) && !illegalComplaintPattern.test(content) && !isOfficialImpactComplaint(content);
  const negativeSignal = (sentimentScore < -0.35 || (denseNegativeSignal && sentimentScore < -0.12)) && !audienceDefused && !skillDefused && !contextDefused && !isolatedCheatMention && !illegalRiskOnly;
  const sensitiveSignal =
    hasContextualSensitiveSignal(content, sentimentProfile, officialImpactSignal) &&
    !illegalRisk.reasons.length &&
    !audienceDefused &&
    !skillDefused &&
    !contextDefused &&
    !isolatedCheatMention;
  const governanceSignal = /(水军|诈骗|未成年|退款|投诉)/.test(content);
  const accountRentalLeadSignal = isAccountRentalLead(content);
  const ss2ReputationSignal = context.ss2OfficialReputationComplaint;
  const currentVersionNegativeComplaint =
    currentVersionComplaint &&
    !audienceDefused &&
    (sentimentScore < -0.12 || denseNegativeSignal);
  const versionSignal = currentVersionTerms.length > 0 && (sentimentScore < -0.18 || currentVersionNegativeComplaint);
  const highEngagementSignal = engagement > 800;
  const elevatedEngagementSignal = engagement > 250;

  if (accountRentalLeadSignal) {
    primaryReasons.push("账号租赁/交易导流");
  }
  if (negativeSignal && !accountRentalLeadSignal) {
    primaryReasons.push(denseNegativeSignal ? "评论区负反馈集中" : "负面表达集中");
  }
  if (sensitiveSignal) {
    primaryReasons.push("命中敏感风险词");
  }
  if (governanceSignal) {
    primaryReasons.push("命中治理类风险词");
  }
  if (ss2ReputationSignal) {
    primaryReasons.push("SS2官方口碑负面");
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
    ss2ReputationSignal,
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

function countNegativeSignalOccurrences(content: string, word: string) {
  if (!word) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(word, cursor);
    if (index < 0) break;
    const lineStart = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", index + word.length);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : content.length;
    const line = content.slice(lineStart, lineEnd);
    const indexInLine = index - lineStart;
    if (!isNeutralNegativeContext(line, word) && !isNegatedIllegalTermContext(line, word, indexInLine)) count += 1;
    cursor = index + word.length;
  }
  return count;
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
  if (word === "准") {
    if (/(不|别|勿|莫)$/.test(prefix)) return true;
    if (/(标|瞄|校|批|核|水|基|允|获)$/.test(prefix)) return true;
  }
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
  return skillShowcaseWords.some((word) => {
    if (word === "准") return countPositiveSignalOccurrences(content, word).positive > 0;
    return content.includes(word);
  });
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
    accountServerInquiry: isAccountServerInquiry(content),
    playerBehaviorComplaint: isPlayerBehaviorComplaint(content),
    personalSkillShare: isPersonalSkillShare(content),
    playerHelpRequest: isPlayerHelpRequest(content),
    routinePlayerShare: isRoutinePlayerShare(content),
    eventUnlockDiscussion: isEventUnlockDiscussion(content),
    eventPromotion: isEventPromotion(content),
    pcHardwarePriceDiscussion: isPcHardwarePriceDiscussion(content),
    ss2OfficialReputationComplaint: isSs2OfficialReputationComplaint(content)
  };
}

function isProtectedDiscussionContext(context: ContextProfile) {
  return (
    context.environmentInquiry ||
    context.accountServerInquiry ||
    context.playerBehaviorComplaint ||
    context.personalSkillShare ||
    context.playerHelpRequest ||
    context.routinePlayerShare ||
    context.eventUnlockDiscussion ||
    context.eventPromotion ||
    context.pcHardwarePriceDiscussion
  );
}

function isStrongComplaint(content: string) {
  return /(垃圾|破游戏|恶心|烂透|没救|倒闭|炸服|闪退|崩溃|白氪|骗氪|退钱|退款|投诉)/.test(content);
}

function isOfficialImpactComplaint(content: string) {
  const officialTarget = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|礼包|礼盒|皮肤|匹配|服务器|交易行|优化|BUG|bug|卡顿|炸服|闪退|封号|封禁|退款|投诉)/;
  const complaint = /(垃圾|破游戏|恶心|烂透|没救|倒闭|白氪|骗氪|逼氪|太贵|退钱|退款|投诉|不修|不管|不开|不开放|卡顿|炸服|闪退|崩溃|异常|问题|离谱|削弱|太弱|难用)/;
  return contentLines(content).some((line) => officialTarget.test(line) && complaint.test(line) && !isNeutralComplaintLine(line));
}

function isSs2OfficialReputationComplaint(content: string) {
  const ss2Context = /(生死狙击2|生死2|SS2|ss2|无端|热油|热游)/;
  if (!ss2Context.test(content)) return false;

  const officialTarget = /(无端|官方|策划|运营|四周年|周年|座谈会|玩家发声|热油|热游)/;
  const reputationComplaint =
    /(锐评|差点卸载|卸载|退游|退坑|取关|招安|被招安|同化|不为玩家发声|毫无攻击性|攻击性.{0,8}零|软了|像狗一样上号|敷衍|背刺|失望)/;
  return contentLines(content).some(
    (line) => officialTarget.test(line) && reputationComplaint.test(line) && !isNeutralComplaintLine(line)
  );
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
  const illegalSignal = hasAnyIllegalTerm(content);
  return skillContext.test(content) && shareAction.test(content) && !officialComplaint.test(content) && !illegalSignal;
}

function isPlayerHelpRequest(content: string) {
  if (isEventQuestion(content)) return true;
  const helpIntent = /(求|请问|问下|问一下|有没有|有无|知道|告知|大佬|大神|专家|萌新|新手|怎么|咋|如何|多少|能不能|要不要|该不该|值不值|建议|攻略|解答|科普)/;
  const helpTopic =
    /(倍率|伤害|穿透|能穿|怎么穿|多少钱|多少能|多少级|多少战力|价格|抽|保底|概率|玩法|模式|决斗场|武器|皮肤|角色|配件|技能|配置|设置|灵敏度|键位|任务|活动|兑换|获取|入坑|回坑|回游|怎么玩|怎么打|怎么提高|怎么提升)/;
  const questionMark = /[?？]/;
  const officialComplaint = /(官方|策划|运营|客服|公告|骗氪|退款|投诉|倒闭|没救|破游戏|垃圾游戏|炸服|闪退|BUG|bug|卡顿)/;
  const illegalSignal = hasAnyIllegalTerm(content);
  return helpIntent.test(content) && (helpTopic.test(content) || questionMark.test(content)) && !officialComplaint.test(content) && !illegalSignal;
}

function isAccountServerInquiry(content: string) {
  const accountOrServerTarget = /(账号|帐号|小号|大号|游戏号|成品号|养老号|空号|战火服.{0,4}号|区服|服务器|战火服|渠道服|官服|页游服|怀旧服|体验服|新区|老区)/;
  const inquiryIntent = /(有没有|有无|谁有|求|收|想买|买|便宜|找|哪里有|能玩|还能玩|就行)/;
  const targetAfterIntent = /(有没有|有无|谁有|求|收|想买|买|便宜|找|哪里有).{0,12}(账号|帐号|小号|大号|游戏号|成品号|养老号|空号|战火服.{0,4}号|区服|服务器|战火服|渠道服|官服|页游服|怀旧服|体验服|新区|老区)/;
  const intentAfterTarget = /(账号|帐号|小号|大号|游戏号|成品号|养老号|空号|战火服.{0,4}号|区服|服务器|战火服|渠道服|官服|页游服|怀旧服|体验服|新区|老区).{0,12}(有没有|有无|谁有|求|收|想买|买|便宜|能玩|还能玩|就行)/;
  const complaint = /(骗子|被骗|诈骗|找回|盗号|黑号|封号|封禁|纠纷|投诉|恶心|垃圾|骂)/;
  const illegalSignal = hasAnyIllegalTerm(content);
  return (
    accountOrServerTarget.test(content) &&
    inquiryIntent.test(content) &&
    (targetAfterIntent.test(content) || intentAfterTarget.test(content)) &&
    !complaint.test(content) &&
    !illegalSignal
  );
}

function isEventQuestion(content: string) {
  const eventTopic = /(联动|活动|版本|更新|爆料|预告|上线|复刻|返场|皮肤|角色|武器)/;
  const questionIntent = /(谁|哪个|哪位|什么|啥|几号|什么时候|是否|有没有|有无|会不会|是不是|了吗|吗|咋|怎么|[?？])/;
  const complaint = isStrongComplaint(content) || isOfficialImpactComplaint(content);
  return eventTopic.test(content) && questionIntent.test(content) && !complaint && !hasAnyIllegalTerm(content);
}

function isEventUnlockDiscussion(content: string) {
  const itemContext = /(礼盒|礼包|活动|绝版|开放|交易|武器|道具|龙魂箭|bug箭|BUG箭)/;
  const unlockContext = /(强开|强行|翘开|封号|封七天|封了|不开|不开放|什么时候|什么原因|上次开放)/;
  const illegalSignal = hasAnyIllegalTerm(content);
  return itemContext.test(content) && unlockContext.test(content) && !illegalSignal;
}

function isEventPromotion(content: string) {
  const eventContext = /(直播|直播间|赛事|比赛|追击赛|官方赛|周年|四周年)/;
  const promotionContext = /(锁定|来看|观看|开播|晚\d{1,2}点|今晚|明晚|加油|督战)/;
  const officialComplaint = isStrongComplaint(content) || isOfficialImpactComplaint(content);
  const illegalSignal = hasAnyIllegalTerm(content);
  return eventContext.test(content) && promotionContext.test(content) && !officialComplaint && !illegalSignal;
}

function isPcHardwarePriceDiscussion(content: string) {
  const hardwareContext =
    /(电脑|3a大作|内存条|固态|硬盘|显卡|机箱|电源|主板|CPU|cpu|风扇|水冷|显示器|键盘|鼠标|音响|4k|三星990|pro2600|扩容)/i;
  const priceContext = /(太贵|价格|多少钱|\d{3,5}多|块钱|元|配下来|便宜)/;
  const gameCommerceContext =
    /(充值|氪金|白氪|骗氪|逼氪|活动|礼包|礼盒|皮肤|道具|武器|抽|保底|概率|交易行|商城|金币|点券|会员晶石|纪念币|专精点|挑战徽章|资质宝石)/;
  const gameIncidentContext = /(官方|策划|运营|客服|公告|更新|版本|BUG|bug|卡顿|炸服|闪退|崩溃|封号|封禁|退款|投诉|倒闭|没救|破游戏|垃圾游戏)/;
  const illegalSignal = hasAnyIllegalTerm(content);
  return hardwareContext.test(content) && priceContext.test(content) && !gameCommerceContext.test(content) && !gameIncidentContext.test(content) && !illegalSignal;
}

function isRoutinePlayerShare(content: string) {
  const shareAction = /(获得|获取|买到|购买|入手|抽到|抽取|出了|开出|晒|分享|记录)/;
  const shareObject = /(武器|皮肤|道具|角色|配件|金蛇|桃光|裁决之音|号|账号|礼包|奖励|战绩|段位|排位|击杀|截图)/;
  const officialComplaint = /(官方|策划|运营|客服|公告|更新|版本|活动|充值|氪金|骗氪|退款|投诉|概率|保底|太贵|降价|倒闭|没救|破游戏|垃圾游戏|炸服|闪退|BUG|bug|卡顿)/;
  const illegalSignal = hasAnyIllegalTerm(content);
  return shareAction.test(content) && shareObject.test(content) && !officialComplaint.test(content) && !illegalSignal;
}

function isCurrentVersionComplaint(content: string) {
  const complaint = /(太弱|弱了|削弱|手感.{0,6}差|很差|没用|不好用|难用|垃圾|恶心|离谱|问题|bug|BUG|卡顿|异常|不生效)/;
  return contentLines(content).some((line) => complaint.test(line) && !isNeutralCurrentVersionComplaintLine(line));
}

function isNeutralCurrentVersionComplaintLine(line: string) {
  if (isNeutralComplaintLine(line)) return true;
  return /(没用过|有没有用|有用没用|能不能用|能用吗|好用吗|好不好|是不是不好|哪里不好|有什么不好|好玩吗)/.test(line);
}

function isNeutralComplaintLine(line: string) {
  return /(有什么问题|有问题可以|问题可以|问题.*(交流|问|咨询|回复|解答)|问.*问题|啥问题|什么问题|哪里有问题|没问题|不是问题)/.test(line);
}

function isAccountRentalLead(content: string) {
  const rentalContext = /(租号|游戏租号|账号租赁|帐号租赁|租赁服务|选号网|号源充足|小杰选号|zhanghaodaren\.com|xiaojie\.)/i;
  const commercialContext = /(平台|官网|客服|订单|下单|租赁|租号|号源|网址|\.com|http)/i;
  return rentalContext.test(content) && commercialContext.test(content);
}

function contentLines(content: string) {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
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
    const line = content.slice(lineStart, lineEnd);
    if (isNegatedIllegalTermContext(line, term, match.index - lineStart)) continue;
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
  return hasNonNegatedPatternMatch(text, illegalCoreTermPattern) || hasNonNegatedPatternMatch(text, illegalToolTermPattern);
}

function hasAnyIllegalTerm(text: string) {
  return hasNonNegatedPatternMatch(text, illegalAnyTermPattern);
}

function hasMultipleHighRiskToolTerms(text: string) {
  const matched = illegalHighRiskToolWords.filter((word) => hasNonNegatedLiteralTerm(text, word));
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
