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
  const engagement =
    (metrics.views || 0) * 0.002 +
    (metrics.replies || 0) * 2 +
    (metrics.comments || 0) * 2 +
    (metrics.danmaku || 0) * 1.2 +
    (metrics.likes || 0) * 0.2 +
    (metrics.shares || 0) * 0.4;

  const reasons: string[] = [];
  const audienceDefused = sentimentProfile.audienceMentions >= 3 && sentimentProfile.audienceScore > 0.12 && sentimentScore > -0.35;
  const skillDefused = sentimentProfile.skillShowcase && sentimentProfile.audienceScore > -0.15 && sentimentScore > -0.35;
  if (sentimentScore < -0.35 && !audienceDefused && !skillDefused) reasons.push("负面表达集中");
  if (engagement > 800) reasons.push("互动量较高");
  if (/(外挂|封号|倒闭|破游戏|没救|白氪|BUG|bug|炸服|闪退)/.test(content)) {
    if (!audienceDefused && !skillDefused) reasons.push("命中敏感风险词");
  }
  if (/(水军|诈骗|未成年|退款|投诉)/.test(content)) {
    reasons.push("命中治理类风险词");
  }

  let level: RiskLevel = "low";
  if (reasons.length >= 2 || (sentimentScore < -0.45 && engagement > 250)) {
    level = "high";
  } else if (reasons.length === 1 || sentimentScore < -0.25) {
    level = "medium";
  }

  return { level, reasons };
}

function summarizeContent(title: string, parts: ContentPart[], topics: string[], sentiment: Sentiment, sentimentProfile: SentimentProfile) {
  const comments = parts.filter((part) => part.type === "comment" || part.type === "danmaku" || part.type === "post");
  const base = compactText(
    [
      title,
      ...parts.filter((part) => part.type === "description" || part.type === "tag").map((part) => part.text),
      ...comments.slice(0, 5).map((part) => part.text)
    ],
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
