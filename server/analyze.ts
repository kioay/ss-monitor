import { negativeWords, positiveWords, topicLexicon } from "./config";
import { clamp, compactText, uniq } from "./utils";
import type { ContentPart, MonitorItem, RiskLevel, Sentiment } from "../src/shared";

interface AnalyzeInput {
  contentParts: ContentPart[];
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

const illegalBehaviorRules = [
  {
    reason: "疑似外挂宣传引流",
    level: "high" as const,
    pattern:
      /(外挂|外卦|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|DMA|驱动|过检测|免封).{0,24}(QQ群|群号|加群|进群|q群|qq|QQ|企鹅|微信|VX|vx|私信|主页|购买|售卖|卡密|代理|月卡|周卡|日卡|接单|体验群|交流群)|(QQ群|群号|加群|进群|q群|qq|QQ|企鹅|微信|VX|vx|私信|主页|购买|售卖|卡密|代理|月卡|周卡|日卡|接单|体验群|交流群).{0,24}(外挂|外卦|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|DMA|驱动|过检测|免封)/
  },
  {
    reason: "疑似外挂演示内容",
    level: "high" as const,
    pattern:
      /(外挂|外卦|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|DMA|驱动|过检测|免封).{0,18}(演示|展示|实测|测试|效果|教程|教学|视频|录屏|第一视角)|(演示|展示|实测|测试|效果|教程|教学|视频|录屏|第一视角).{0,18}(外挂|外卦|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|DMA|驱动|过检测|免封)/
  },
  {
    reason: "命中外挂/脚本高危词",
    level: "high" as const,
    pattern: /(内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|无后座|无后坐|DMA|驱动挂|过检测|免封|辅助售卖|外挂售卖|科技售卖)/
  },
  {
    reason: "命中外挂治理线索",
    level: "medium" as const,
    pattern: /(外挂|外卦|开挂|挂狗|科技|辅助|作弊|封号|封禁|举报|锁头|透视|宏)/
  }
];

export function analyzeItem(input: AnalyzeInput) {
  const content = input.contentParts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n");

  const topics = Object.entries(topicLexicon)
    .filter(([, words]) => words.some((word) => content.includes(word)))
    .map(([topic]) => topic);

  const sentimentProfile = scoreSentiment(input.contentParts);
  const sentimentScore = sentimentProfile.score;
  const sentiment = labelSentiment(sentimentProfile, content);
  const keywords = extractKeywords(content, topics);
  const risk = assessRisk(content, sentimentProfile, input.metrics);
  const summary = summarizeContent(input.title, input.contentParts, topics, sentiment, sentimentProfile);

  return {
    topics: topics.length ? topics : ["综合讨论"],
    sentiment,
    sentimentScore,
    keywords,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    summary
  };
}

function scoreSentiment(parts: ContentPart[]): SentimentProfile {
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
    const signal = scoreTextSignals(part.text);
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

function scoreTextSignals(content: string) {
  let positive = 0;
  let negative = 0;

  for (const word of uniq([...positiveWords, ...audiencePraiseWords])) {
    positive += countOccurrences(content, word);
  }

  for (const word of negativeWords) {
    negative += countOccurrences(content, word);
  }

  if ((content.includes("？") || content.includes("?")) && negative > positive) negative += 0.2;
  if ((content.includes("！！") || content.includes("!!")) && negative > positive) negative += 0.2;

  return { positive, negative };
}

function normalizedScore(positive: number, negative: number) {
  const total = positive + negative;
  if (!total) return 0;
  return clamp((positive - negative) / Math.max(2, total), -1, 1);
}

function labelSentiment(profile: SentimentProfile, content: string): Sentiment {
  const hasPositive = positiveWords.some((word) => content.includes(word));
  const hasNegative = negativeWords.some((word) => content.includes(word));
  if (profile.audienceMentions >= 3 && profile.audienceScore > 0.15 && profile.score > -0.35) return "positive";
  if (profile.audienceMentions >= 3 && profile.audienceScore < -0.25 && profile.score < 0.2) return "negative";
  if (profile.skillShowcase && profile.score > -0.35 && profile.audienceScore > -0.2) {
    return profile.score > 0.16 || profile.audienceScore > 0.08 ? "positive" : "neutral";
  }
  if (hasPositive && hasNegative && Math.abs(profile.score) < 0.25) return "mixed";
  if (profile.score > 0.18) return "positive";
  if (profile.score < -0.18) return "negative";
  return "neutral";
}

function extractKeywords(content: string, topics: string[]) {
  const domainWords = uniq(Object.values(topicLexicon).flat());
  const matched = domainWords.filter((word) => content.includes(word));
  const english = content.match(/[A-Za-z][A-Za-z0-9+-]{1,12}/g) || [];
  const numbers = content.match(/\d{1,4}(?:\.\d+)?(?:月|日|版本|战力|元)?/g) || [];

  return uniq([...topics, ...matched, ...english, ...numbers])
    .filter((word) => word.length > 1)
    .slice(0, 10);
}

function assessRisk(content: string, sentimentProfile: SentimentProfile, metrics: MonitorItem["metrics"]) {
  const sentimentScore = sentimentProfile.score;
  const illegalRisk = detectIllegalBehavior(content);
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
  const environmentInquiry = isEnvironmentInquiry(content);
  if (sentimentScore < -0.35 && !audienceDefused && !skillDefused && !environmentInquiry) primaryReasons.push("负面表达集中");
  if (/(外挂|封号|倒闭|破游戏|没救|白氪|BUG|bug|炸服|闪退)/.test(content)) {
    if (!illegalRisk.reasons.length && !audienceDefused && !skillDefused && !environmentInquiry) primaryReasons.push("命中敏感风险词");
  }
  if (/(水军|诈骗|未成年|退款|投诉)/.test(content)) {
    primaryReasons.push("命中治理类风险词");
  }

  let level: RiskLevel = "low";
  if (illegalRisk.level === "high" || primaryReasons.length >= 2 || (sentimentScore < -0.45 && engagement > 250)) {
    level = "high";
  } else if (illegalRisk.level === "medium" || primaryReasons.length === 1 || sentimentScore < -0.25) {
    level = "medium";
  }
  if (environmentInquiry && illegalRisk.level !== "high" && level === "high") level = "medium";

  const reasons = [...primaryReasons];
  if (environmentInquiry && level !== "low") reasons.push("回游/环境询问语境");
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

function isEnvironmentInquiry(content: string) {
  const inquiryTone = /[?？]|吗|么|咋样|怎样|怎么样|如何|好不好|能不能|能玩吗|还能玩|值得|现在|目前/.test(content);
  const returnIntent = /回游|回坑|回归|想玩|准备玩|入坑|萌新|新手|游戏荒|荒了/.test(content);
  const environmentTopic = /环境|游戏环境|现状|生态|人多|人少|匹配|排位|外挂多|挂多|科技多|封号|服务器|还能玩吗|好玩吗/.test(content);
  return (returnIntent && (environmentTopic || inquiryTone)) || (environmentTopic && inquiryTone);
}

function detectIllegalBehavior(content: string) {
  const reasons: string[] = [];
  let level: RiskLevel = "low";

  for (const rule of illegalBehaviorRules) {
    if (!rule.pattern.test(content)) continue;
    reasons.push(rule.reason);
    if (rule.level === "high") level = "high";
    else if (level !== "high") level = "medium";
  }

  return { level, reasons };
}

function maskContactInfo(text: string) {
  return text
    .replace(/(QQ群|群号|QQ|qq|q群|企鹅|微信|VX|vx)[:：\s-]*[A-Za-z0-9_-]{5,16}/g, "$1[已隐藏]")
    .replace(/(加群|进群|私信|联系|购买|售卖|卡密|代理).{0,8}(\d{5,12})/g, "$1[已隐藏]");
}
