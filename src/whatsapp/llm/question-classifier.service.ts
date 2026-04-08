import { Injectable, Logger } from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  Annotation,
} from '@langchain/langgraph';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Result, Ok, Err, Option } from 'oxide.ts';

export interface QuestionClassification {
  isUniqueQuestion: boolean;
  reasoning: string;
  questionType:
    | 'greeting'
    | 'followup'
    | 'clarification'
    | 'new_question'
    | 'acknowledgment'
    | 'other';
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a question classification expert for an agricultural advisory system.

Your task is to analyze user messages in the context of their conversation history and determine if the current message represents a NEW UNIQUE QUESTION that requires expert review.

CLASSIFICATION RULES:

1. **NEW UNIQUE QUESTION** (isUniqueQuestion = true):
   - The user is asking about a specific agricultural problem, crop disease, pest issue, or farming technique
   - The question introduces a NEW topic not covered in recent conversation
   - The question requires expert knowledge or detailed agricultural guidance
   - Examples: "My tomato plants have yellow leaves", "How to control aphids on cotton?", "Best fertilizer for wheat in Rabi season?"

2. **NOT A UNIQUE QUESTION** (isUniqueQuestion = false):
   - Greetings and pleasantries: "Hi", "Hello", "Good morning", "How are you?"
   - Follow-up questions: "What about the dosage?", "And the timing?", "Can you explain more?"
   - Clarifications on previous answers: "I didn't understand that", "What do you mean by that?"
   - Acknowledgments: "Thanks", "OK", "Got it", "I understand"
   - Simple confirmations or status updates: "Yes", "No", "Done"
   - Repetitions of the same question asked recently (within last 3-5 messages)

3. **CONTEXT ANALYSIS**:
   - Check the last 5-10 messages to understand conversation flow
   - If the user is continuing discussion on the SAME topic → NOT a new question
   - If the user switches to a DIFFERENT agricultural topic → NEW question
   - Consider whether the current message can be answered using context from recent messages

RESPONSE FORMAT:
You must respond with a valid JSON object in this exact format:
{
  "isUniqueQuestion": true or false,
  "reasoning": "Brief explanation",
  "questionType": "greeting" | "followup" | "clarification" | "new_question" | "acknowledgment" | "other"
}

IMPORTANT: Return ONLY the JSON object, nothing else. No markdown, no extra text.

Remember: The goal is to avoid uploading duplicate questions or non-questions to the expert review system while ensuring all genuine new agricultural queries are captured.`;

@Injectable()
export class QuestionClassifierService {
  private readonly logger = new Logger(QuestionClassifierService.name);
  private classifierGraph: ReturnType<typeof this.createClassifierGraph>;
  private llm: ChatAnthropic;

  constructor() {
    this.llm = new ChatAnthropic({
      modelName:
        process.env.LLM_MODEL === 'default'
          ? 'claude-3-5-sonnet-20240620'
          : process.env.LLM_MODEL || 'claude-3-5-sonnet-20240620',
      apiKey: process.env.LLM_API_KEY || 'dummy-key',
      temperature: 0.1,
      maxTokens: 500,
    });

    this.classifierGraph = this.createClassifierGraph();
  }

  private createClassifierGraph() {
    const ClassifierState = Annotation.Root({
      ...MessagesAnnotation.spec,
      classification: Annotation<QuestionClassification | undefined>(),
    });

    const classifyNode = async (state: typeof ClassifierState.State) => {
      this.logger.debug(
        `Classifying message with ${state.messages.length} context messages`,
      );

      const systemMessage = new SystemMessage(CLASSIFIER_SYSTEM_PROMPT);
      const messages = [systemMessage, ...state.messages];

      const llmResult = await Result.safe(this.llm.invoke(messages));

      const classification = llmResult
        .andThen((result) => this.extractContent(result))
        .andThen((content) => this.parseClassification(content))
        .unwrapOr(this.defaultClassification());

      this.logger.log(
        `Classification result: ${JSON.stringify(classification)}`,
      );

      return {
        classification,
      };
    };

    const graph = new StateGraph(ClassifierState)
      .addNode('classify', classifyNode)
      .addEdge(START, 'classify')
      .addEdge('classify', END);

    return graph.compile();
  }

  private extractContent(result: any): Result<string, Error> {
    if (typeof result.content === 'string') {
      return Ok(result.content);
    }

    if (Array.isArray(result.content)) {
      const content = result.content
        .filter((b) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      return content ? Ok(content) : Err(new Error('No text content found'));
    }

    return Err(new Error('Invalid content type'));
  }

  private parseClassification(
    content: string,
  ): Result<QuestionClassification, Error> {
    this.logger.debug(`Raw LLM response: ${content}`);

    const jsonMatch = Option(content.match(/\{[\s\S]*\}/));
    const jsonStr = jsonMatch.map((m) => m[0]).unwrapOr(content);

    const parsed = Result.safe(() => JSON.parse(jsonStr));

    const fromParsed = parsed.andThen((obj) => {
      if (
        typeof obj.isUniqueQuestion === 'boolean' &&
        typeof obj.reasoning === 'string'
      ) {
        return Ok({
          isUniqueQuestion: obj.isUniqueQuestion,
          reasoning: obj.reasoning || 'No reasoning provided',
          questionType: this.validateQuestionType(obj.questionType),
        });
      }
      return Err(new Error('Invalid classification structure'));
    });

    return fromParsed
      .mapErr((error) => {
        this.logger.warn(`Failed to parse classification: ${error.message}`);
        return error;
      })
      .or(this.inferFromText(content));
  }

  private inferFromText(
    content: string,
  ): Result<QuestionClassification, Error> {
    const lowerContent = content.toLowerCase();

    if (
      lowerContent.includes('isuniqueQuestion": true') ||
      lowerContent.includes('is a new unique question') ||
      lowerContent.includes('should be uploaded')
    ) {
      return Ok({
        isUniqueQuestion: true,
        reasoning: 'Inferred from text response',
        questionType: 'new_question',
      });
    }

    if (
      lowerContent.includes('isuniqueQuestion": false') ||
      lowerContent.includes('not a new unique question') ||
      lowerContent.includes('should not be uploaded')
    ) {
      return Ok({
        isUniqueQuestion: false,
        reasoning: 'Inferred from text response',
        questionType: 'other',
      });
    }

    return Err(new Error('Could not infer classification from text'));
  }

  private validateQuestionType(
    type: any,
  ): QuestionClassification['questionType'] {
    const validTypes = [
      'greeting',
      'followup',
      'clarification',
      'new_question',
      'acknowledgment',
      'other',
    ];
    return validTypes.includes(type) ? type : 'other';
  }

  private defaultClassification(): QuestionClassification {
    return {
      isUniqueQuestion: true,
      reasoning: 'Classification failed - defaulting to unique for safety',
      questionType: 'other',
    };
  }

  async classifyMessage(
    currentMessage: string,
    conversationHistory: BaseMessage[],
  ): Promise<QuestionClassification> {
    this.logger.log(`Classifying message: "${currentMessage.slice(0, 60)}..."`);

    const messages = [
      ...conversationHistory,
      new HumanMessage(
        `Analyze this message: "${currentMessage}"\n\nIs this a new unique agricultural question that needs expert review?`,
      ),
    ];

    const result = await Result.safe(this.classifierGraph.invoke({ messages }));

    const classification = result
      .map((r: any) => {
        if (r.classification) {
          return r.classification as QuestionClassification;
        }
        this.logger.warn('No classification in result, using default');
        return this.defaultClassification();
      })
      .unwrapOr(this.defaultClassification());

    this.logger.log(
      `Classification: ${classification.isUniqueQuestion ? 'UNIQUE' : 'NOT UNIQUE'} ` +
        `(${classification.questionType}) - ${classification.reasoning}`,
    );

    return classification;
  }

  async shouldUploadToReviewer(
    currentMessage: string,
    conversationHistory: BaseMessage[],
  ): Promise<boolean> {
    const classification = await this.classifyMessage(
      currentMessage,
      conversationHistory,
    );
    return classification.isUniqueQuestion;
  }
}
