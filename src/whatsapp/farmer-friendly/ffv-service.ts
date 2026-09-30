import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface FFVQARecord {
  question: string;
  shortAnswer: string;
  bigAnswer: string;
}

export interface FFVQAResult {
  found: boolean;
  shortAnswer?: string;
  bigAnswer?: string;
  questionId?: string;
}
const big_answer = `Leaf miner is an important insect pest of pea, with damage generally more severe during December to March. The larvae make tunnels between the upper and lower epidermis of the leaves, which interferes with photosynthesis and proper plant growth. Effective management includes regular monitoring, removal and destruction of infested leaves, conservation of natural enemies, use of suitable trap crops, and need-based chemical control. 
    
1. Identification of leaf miner
 
 The adult leaf miner is a pale yellowish fly about 1.5 mm long. The female punctures the upper surface of the leaf and lays eggs singly. The eggs are minute and orange-yellow and hatch in about 4 days. The larva is an apodous maggot that feeds on chlorophyll between the upper and lower epidermal layers and grows to about 3 mm in length, with a larval period of about 7 days. Pupation occurs inside a thin, loose mesh of silken cocoon and lasts about 7 days. The complete life cycle takes about 3 weeks.
 
 2. Damage symptoms
 
 The larvae make numerous tunnels or mines between the upper and lower epidermis of the leaves, which interfere with photosynthesis and proper plant growth. The affected leaves develop characteristic serpentine mines and blotches and may become unattractive. In severe infestations, the leaves may dry and drop. The pest also sucks the juice of the stem and leaves, further affecting plant growth.
 
 3. Monitoring and ETL
 
 Regular monitoring is important for detecting leaf miner infestation at an early stage. For monitoring, count and record only the number of live mines on five randomly selected leaves per plant. This observation can help assess the level of infestation and guide the need for management measures.
 
 4. Cultural control
 
 Remove and destroy infested leaves showing leaf miner mines and blotches to reduce the pest population and prevent further spread. Tomato or marigold can also be grown as trap crops for leaf miner management. These practices should be carried out regularly, particularly during the period of higher pest activity from December to March.
 
 5. Biological control
 
 Conserve the natural enemies of leaf miner through ecological engineering and avoid practices that unnecessarily disturb beneficial organisms. Augmentative release of natural enemies can also be followed as a biological management practice. Conservation and augmentation of natural enemies can help suppress the leaf miner population as part of integrated pest management.
 
 6. Chemical control
 
 When leaf miner infestation begins, apply Oxydemeton methyl 25% EC @ 1 litre/ha in 1,000 litres of water/ha. The equivalent dose is approximately 405 ml/acre in 405 litres of water/acre. If required according to the recommendation, repeat the application at 15-day intervals. Use the pesticide only according to the applicable product label and recommended crop-specific instructions.
 
 7. Safety measures
 
 Handle pesticides carefully during preparation and application. Read and follow the product label, use the recommended dose, and wear appropriate protective equipment to avoid direct contact with the pesticide. Keep pesticides away from children, animals, food, and feed, and avoid unnecessary applications that may harm beneficial natural enemies. Follow the recommended waiting period and other safety instructions given on the approved product label.
 
 Conclusion
 
 Effective management of leaf miner in pea should focus on early identification, regular monitoring, removal and destruction of infested leaves, trap cropping, and conservation of natural enemies. The pest is more damaging during December to March, and its larvae cause serpentine mines that interfere with photosynthesis and plant growth. For chemical control, Oxydemeton methyl 25% EC @ 1 litre/ha in 1,000 litres of water/ha, equivalent to approximately 405 ml/acre in 405 litres of water/acre, can be applied when the attack begins and repeated at 15-day intervals as recommended. Combining cultural, biological, monitoring, and need-based chemical measures can help reduce leaf miner damage and protect pea crop growth and productivity.

👤 Answered by: SURAIYA AMIN

📚 Sources:
🔗 AESA Based IPM Package on Pea_NIPHM, Hyderabad, Telangana : https://workdrive.zohoexternal.in/file/5xofr4f6f9bf806cf46b592cbde1ca4a5f989
🔗 Field Pea Production Technology_Directorate of Pulses Developement_ Madhya Pradesh: https://workdrive.zohoexternal.in/file/at1bvf44c2eadd89c4e6bb5878c5b21cb6e5e

⚠️ Important Notice (Testing) ⚠️

This AjraSakha application is under development and intended only for testing and validation.
Advisories are experimental and currently cover major crops in selected states.
Weather data is sourced from IMD.
Market data from eNAM, Agmarknet, and State APMCs.
Soil health guidance from https://soilhealth.dac.gov.in/fertilizer-dosage.
Government schemes from https://www.myscheme.gov.in/.
Other agricultural information and advisories are expert-verified by Annam.ai.

Users should independently validate recommendations before acting.`
// Hardcoded Q&A for demo - Leaf Miner in Pea
const DEMO_QAS: FFVQARecord[] = [
  {
    question: "How can I identify Leaf Miner Pest in Pea crop?",
    shortAnswer: "The adult leaf miner is a pale yellowish fly about 1.5 mm long. The female punctures the upper surface of the leaf and lays eggs singly. The larva is an apodous maggot that feeds on chlorophyll between the upper and lower epidermal layers and grows to about 3 mm in length, with a larval period of about 7 days. Pupation occurs inside a thin, loose mesh of silken cocoon and lasts about 7 days.",
    bigAnswer: big_answer
  },
  {
    question: "What are the damage symptoms of Leaf Miner infestation in Pea crop?",
    shortAnswer: "The larvae make numerous tunnels or mines between the upper and lower epidermis of the leaves, which interfere with photosynthesis and proper plant growth. The affected leaves develop characteristic serpentine mines and blotches and may become unattractive. In severe infestations, the leaves may dry and drop. The pest also sucks the juice of the stem and leaves, further affecting plant growth.",
    bigAnswer: big_answer
  },
  {
    question: "How should a farmer monitor leaf miner infestation in Pea?",
    shortAnswer: "Regular monitoring is important for detecting leaf miner infestation at an early stage. For monitoring, count and record only the number of live mines on five randomly selected leaves per plant. This observation can help assess the level of infestation and guide the need for management measures.",
    bigAnswer: big_answer
  },
  {
    question: "What cultural or preventive measures can be used to reduce leaf miner infestation in pea?",
    shortAnswer: "Remove and destroy infested leaves showing leaf miner mines and blotches to reduce the pest population and prevent further spread. Tomato or marigold can also be grown as trap crops for leaf miner management. These practices should be carried out regularly, particularly during the period of higher pest activity from December to March.",
    bigAnswer: big_answer
  },
  {
    question: "Why Natural enemies are conserved in pea cultivation and what biological practices are recommended to control leaf miner pest in pea?",
    shortAnswer: "Conserve the natural enemies of leaf miner through ecological engineering and avoid practices that unnecessarily disturb beneficial organisms. Augmentative release of natural enemies can also be followed as a biological management practice. Conservation and augmentation of natural enemies can help suppress the leaf miner population as part of integrated pest management.",
    bigAnswer: big_answer
  },
  {
    question: "What are the effective management strategies and chemical controls for managing Leaf Miner infestation in Pea crops in Madhya Pradesh?",
    shortAnswer: "Effective management of leaf miner in pea should focus on early identification, regular monitoring, removal and destruction of infested leaves, trap cropping, and conservation of natural enemies. The pest is more damaging during December to March, and its larvae cause serpentine mines that interfere with photosynthesis and plant growth. For chemical control, Oxydemeton methyl 25% EC @ 1 litre/ha in 1,000 litres of water/ha, equivalent to approximately 405 ml/acre in 405 litres of water/acre, can be applied when the attack begins and repeated at 15-day intervals as recommended. Combining cultural, biological, monitoring, and need-based chemical measures can help reduce leaf miner damage and protect pea crop growth and productivity.",
    bigAnswer: big_answer
  },
  {
    question: "What are the safety and precautions should I follow while spraying insecticides against Leaf Miner in Pea?",
    shortAnswer: "Handle pesticides carefully during preparation and application. Read and follow the product label, use the recommended dose, and wear appropriate protective equipment to avoid direct contact with the pesticide. Keep pesticides away from children, animals, food, and feed, and avoid unnecessary applications that may harm beneficial natural enemies. Follow the recommended waiting period and other safety instructions given on the approved product label.",
    bigAnswer: big_answer
  }
];

@Injectable()
export class FFVService implements OnModuleInit {
  private readonly logger = new Logger(FFVService.name);
  private qaRecords: FFVQARecord[] = [];
  private questionIdMap: Map<string, FFVQARecord> = new Map();
  private lastQuestionMap: Map<string, string> = new Map();
  private questionIndex: Map<string, number> = new Map(); // For fuzzy matching

  async onModuleInit(): Promise<void> {
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.qaRecords = DEMO_QAS;
    
    this.questionIdMap.clear();
    this.questionIndex.clear();
    
    this.qaRecords.forEach((record, index) => {
      const questionId = `ffv_q_${index + 1}`;
      this.questionIdMap.set(questionId, record);
      // Store lowercase version for matching
      this.questionIndex.set(record.question.toLowerCase(), index);
    });

    this.logger.log(`FFV: Loaded ${this.qaRecords.length} hardcoded Q&A records`);
  }

  /**
   * Find a matching Q&A record for the given question
   */
  findMatchingQA(userQuestion: string): FFVQAResult {
    if (this.qaRecords.length === 0) {
      return { found: false };
    }

    const normalizedQuestion = userQuestion.toLowerCase().trim();

    // Skip very short inputs
    if (normalizedQuestion.length < 10) {
      return { found: false };
    }

    // Try exact match first
    const exactIndex = this.questionIndex.get(normalizedQuestion);
    if (exactIndex !== undefined) {
      const record = this.qaRecords[exactIndex];
      const questionId = `ffv_q_${exactIndex + 1}`;
      return {
        found: true,
        shortAnswer: record.shortAnswer,
        bigAnswer: record.bigAnswer,
        questionId,
      };
    }

    // Try partial match - check if any record question is contained in user question or vice versa
    for (let i = 0; i < this.qaRecords.length; i++) {
      const record = this.qaRecords[i];
      const recordQuestion = record.question.toLowerCase();
      
      // Check if user question contains key words from record question
      const keyWords = ['leaf miner', 'pea', 'chemical', 'control', 'monitor', 'cultural', 'biological', 'safety', 'damage', 'identify'];
      const matchingKeywords = keyWords.filter(kw => 
        normalizedQuestion.includes(kw) && recordQuestion.includes(kw)
      );
      
      if (matchingKeywords.length >= 2) {
        const questionId = `ffv_q_${i + 1}`;
        return {
          found: true,
          shortAnswer: record.shortAnswer,
          bigAnswer: record.bigAnswer,
          questionId,
        };
      }
    }

    return { found: false };
  }

  getByQuestionId(questionId: string): FFVQAResult {
    const record = this.questionIdMap.get(questionId);
    if (!record) {
      return { found: false };
    }
    return {
      found: true,
      shortAnswer: record.shortAnswer,
      bigAnswer: record.bigAnswer,
      questionId,
    };
  }

  setLastQuestionId(phoneNumber: string, questionId: string): void {
    this.lastQuestionMap.set(phoneNumber, questionId);
  }

  getLastQuestionId(phoneNumber: string): string | undefined {
    return this.lastQuestionMap.get(phoneNumber);
  }

  isEnabled(): boolean {
    return this.qaRecords.length > 0;
  }

  getRecordCount(): number {
    return this.qaRecords.length;
  }

  // Get all questions for the demo menu
  getAllQuestions(): string[] {
    return this.qaRecords.map((q, i) => `${i + 1}. ${q.question}`);
  }
}