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
  },
  {
    question: "ಕರ್ನಾಟಕ-ದ ಅಡಿಕೆ ತೋಟಗಳಲ್ಲಿ ಬಡ್ ರೋಟ್ ರೋಗಕ್ಕೆ ಪರಿಣಾಮಕಾರಿ ನಿರ್ವಹಣೆ ಮತ್ತು ನಿಯಂತ್ರಣ ಕ್ರಮಗಳು ಯಾವುವು?",
    shortAnswer: "ಅಡಿಕೆ ತೋಟಗಳಲ್ಲಿ ಮೊಗ್ಗು ಕೊಳೆ  ರೋಗದ ಪರಿಣಾಮಕಾರಿ ನಿರ್ವಹಣೆಯು ತೋಟದ ನೈರ್ಮಲ್ಯವನ್ನು ಕಾಪಾಡಿಕೊಳ್ಳುವುದು, ಪೀಡಿತ ಸಸ್ಯ ಭಾಗಗಳನ್ನು ತೆಗೆದುಹಾಕುವುದು ಮತ್ತು ನಾಶಪಡಿಸುವುದು ಮತ್ತು ಸ್ಪಿಂಡಲ್ ಭಾಗಕ್ಕೆ ಶಿಫಾರಸು ಮಾಡಲಾದ ಶಿಲೀಂಧ್ರನಾಶಕ ಚಿಕಿತ್ಸೆಗಳನ್ನು ಅನ್ವಯಿಸುವುದನ್ನು ಒಳಗೊಂಡಿರುತ್ತದೆ. ಆರಂಭಿಕ ಗುರುತಿಸುವಿಕೆ ಮತ್ತು ಸಕಾಲದಲ್ಲಿ ನಿರ್ವಹಣೆ ರೋಗದ ಬೆಳವಣಿಗೆಯನ್ನು ಕಡಿಮೆ ಮಾಡಲು ಮತ್ತು ಮರಕ್ಕೆ ಮತ್ತಷ್ಟು ಹಾನಿಯನ್ನು ತಡೆಗಟ್ಟಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
    bigAnswer: `
    ಮೊಗ್ಗು ಕೊಳೆ ರೋಗ, ಇದನ್ನು ಸುಳಿ ಕೊಳೆ ರೋಗ ಅಥವಾ ಕಿರೀಟ ಕೊಳೆ ರೋಗ ಎಂದೂ ಕರೆಯುತ್ತಾರೆ, ಇದು ಅಡಿಕೆಯ ಒಂದು ಪ್ರಮುಖ ರೋಗವಾಗಿದೆ. ಈ ರೋಗವು ಮುಖ್ಯವಾಗಿ ಮರದ ಸುಳಿ ಮತ್ತು ಬೆಳೆಯುವ ಭಾಗವನ್ನು ಬಾಧಿಸುತ್ತದೆ. ತೋಟದ ನೈರ್ಮಲ್ಯವನ್ನು ಕಾಪಾಡುವುದು, ರೋಗಪೀಡಿತ ಭಾಗಗಳನ್ನು ತೆಗೆದುಹಾಕುವುದು ಮತ್ತು ಬಾಧಿತ ಸುಳಿ ಭಾಗಕ್ಕೆ ಶಿಫಾರಸು ಮಾಡಿದ ಶಿಲೀಂಧ್ರನಾಶಕ ಚಿಕಿತ್ಸೆಗಳನ್ನು ಅನ್ವಯಿಸುವುದು ಪರಿಣಾಮಕಾರಿ ನಿರ್ವಹಣೆಯಲ್ಲಿ ಒಳಗೊಂಡಿದೆ.
*ರೋಗಲಕ್ಷಣಗಳು*
- ಆರಂಭದಲ್ಲಿ ಸುಳಿ ಮತ್ತು ಎಲೆಗಳು ಹಳದಿ ಬಣ್ಣಕ್ಕೆ ತಿರುಗುತ್ತವೆ.
- ಬೆಳೆಯುತ್ತಿರುವ ಸುಳಿ ಕೊಳೆತು, ಎಳೆದಾಗ ಸುಲಭವಾಗಿ ಹೊರಬರುತ್ತದೆ.
- ಹಸಿರು ಎಲೆಗಳು ಕೆಳಗೆ ಜೋತು ಬೀಳುತ್ತವೆ, ಆದರೆ ಎಲೆ ಕವಚಗಳು ಮತ್ತು ಹೊರಗಿನ ಎಲೆಗಳು ಹಳದಿ ಬಣ್ಣಕ್ಕೆ ತಿರುಗುತ್ತವೆ.
- ಬಾಧಿತ ಎಲೆಗಳ ಒಳಭಾಗದಲ್ಲಿ ನೀರಿನಿಂದ ನೆನೆದಂತಹ ಚುಕ್ಕೆಗಳು ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತವೆ.
- ಹೂಗೊಂಚಲು ಸಹ ಕೊಳೆಯುತ್ತದೆ.
- ತೀವ್ರ ಸಂದರ್ಭಗಳಲ್ಲಿ, ರೋಗಪೀಡಿತ ಮರ ಸಾಯುತ್ತದೆ.
- ಮರದ ಮೇಲ್ಭಾಗವು ಸೋಂಕಿತ ಭಾಗದಿಂದ ಮುರಿದು ಬೀಳಬಹುದು.
*ನಿರ್ವಹಣಾ ಕ್ರಮಗಳು:*
*ಬೇಸಾಯ ಮತ್ತು ಯಾಂತ್ರಿಕ ನಿರ್ವಹಣೆ*
- ಕೊಳೆ ರೋಗದಿಂದ ಬಾಧಿತವಾದ ಒಣಗಿದ ಗೊಂಚಲುಗಳು, ಉದುರಿದ ಕಾಯಿಗಳು ಮತ್ತು ಮೊಗ್ಗು ಅಥವಾ ಸುಳಿ ಕೊಳೆ ರೋಗದಿಂದ ಬಾಧಿತವಾದ ಮರಗಳನ್ನು ನಾಶಪಡಿಸುವ ಮೂಲಕ ಅಡಿಕೆ ತೋಟವನ್ನು ಸ್ವಚ್ಛವಾಗಿಡಿ.
- ಮರದ ರೋಗಪೀಡಿತ ಭಾಗವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ತೆಗೆದುಹಾಕಿ.
- ತೀವ್ರವಾಗಿ ಸೋಂಕಿತ ಅಥವಾ ಸತ್ತ ಸುಳಿ ಎಲೆಗಳು ಮತ್ತು ಬಾಧಿತ ಕಿರೀಟ ಅಂಗಾಂಶಗಳನ್ನು ತೆಗೆದು ನಾಶಪಡಿಸಿ.
- ಆರೋಗ್ಯಕರ ಅಂಗಾಂಶ ಕಾಣಿಸುವವರೆಗೆ ರೋಗಪೀಡಿತ ಅಂಗಾಂಶವನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ಕತ್ತರಿಸಿ ತೆಗೆಯಿರಿ.
- ಮರದ ಸುತ್ತಲಿನ ಉದುರಿದ ಸೋಂಕಿತ ಎಲೆಗಳು ಮತ್ತು ಸಸ್ಯದ ಅವಶೇಷಗಳನ್ನು ತೆಗೆದುಹಾಕಿ.
*ಜೈವಿಕ ನಿರ್ವಹಣೆ*
- ತಿಪ್ಪೆ ಗೊಬ್ಬರ, ಕಾಂಪೋಸ್ಟ್ ಅಥವಾ ಇತರ ಸೂಕ್ತ ಸಾವಯವ ಪೂರಕಗಳ ಮೂಲಕ ಮಣ್ಣಿನಲ್ಲಿ ಸಾಕಷ್ಟು ಸಾವಯವ ಪದಾರ್ಥವನ್ನು ಕಾಪಾಡಿ.
- ವಿಶಾಲ-ಶ್ರೇಣಿಯ ಶಿಲೀಂಧ್ರನಾಶಕಗಳ ಅನಗತ್ಯ ಬಳಕೆಯನ್ನು ತಪ್ಪಿಸುವ ಮೂಲಕ ಉಪಯುಕ್ತ ಸೂಕ್ಷ್ಮಜೀವಿಗಳನ್ನು ಸಂರಕ್ಷಿಸಿ.
*ರಾಸಾಯನಿಕ ನಿರ್ವಹಣೆ*
- ತೆಗೆದುಹಾಕಿದ ಅಥವಾ ಬಾಧಿತ ಭಾಗಕ್ಕೆ ಕೆಳಗೆ ನಿರ್ದಿಷ್ಟಪಡಿಸಿದಂತೆ ಶಿಫಾರಸು ಮಾಡಿದ ಶಿಲೀಂಧ್ರನಾಶಕ ಚಿಕಿತ್ಸೆಯನ್ನು ಅನ್ವಯಿಸಿ.
- ರೋಗಪೀಡಿತ ಭಾಗವನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ತೆಗೆದುಹಾಕಿ ಆ ಭಾಗಕ್ಕೆ ಶೇ. 10 ಬೋರ್ಡೋ ಮಿಶ್ರಣವನ್ನು ಹಚ್ಚಿ. (ಪ್ರತಿ ಲೀಟರ್ ನೀರಿಗೆ 100 ಗ್ರಾಂ.)
- ಪರ್ಯಾಯವಾಗಿ, ಬಾಧಿತ ಭಾಗಕ್ಕೆ ಶೇ. 3 ಕಾಪರ್ ಆಕ್ಸಿಕ್ಲೋರೈಡ್ 50% WP ಹಚ್ಚಿ. (ಪ್ರತಿ ಲೀಟರ್ ನೀರಿಗೆ 30 ಗ್ರಾಂ.)
- ರೋಗ ಬೆಳವಣಿಗೆಯ ಆರಂಭದಲ್ಲಿ, ಸುಳಿ ಭಾಗವು ಸಂಪೂರ್ಣವಾಗಿ ನೆನೆಯುವಂತೆ ರೋಗಪೀಡಿತ ಮರಗಳಿಗೆ ಶೇ. 1 ಬೋರ್ಡೋ ಮಿಶ್ರಣವನ್ನು ಸಿಂಪಡಿಸಿ (ಪ್ರತಿ ಲೀಟರ್ ನೀರಿಗೆ 10 ಗ್ರಾಂ).
- ಪರ್ಯಾಯವಾಗಿ, ಸುಳಿ ಭಾಗವು ಸಂಪೂರ್ಣವಾಗಿ ನೆನೆಯುವಂತೆ ಪ್ರತಿ ಲೀಟರ್ ನೀರಿಗೆ 3 ಗ್ರಾಂ ಕಾಪರ್ ಆಕ್ಸಿಕ್ಲೋರೈಡ್ 50% WP ಸಿಂಪಡಿಸಿ.
- ಪರ್ಯಾಯವಾಗಿ, ಸುಳಿ ಭಾಗಕ್ಕೆ ಪ್ರತಿ ಲೀಟರ್ ನೀರಿಗೆ 2 ಗ್ರಾಂ ಮೆಟಾಲಾಕ್ಸಿಲ್ 8% + ಮ್ಯಾಂಕೋಜೆಬ್ 64% WP ಸಿಂಪಡಿಸಿ.
*ಸುರಕ್ಷತಾ ಮುನ್ನೆಚ್ಚರಿಕೆಗಳು*
- ರೋಗಪೀಡಿತ ಭಾಗಗಳನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ತೆಗೆದು ಶಿಫಾರಸು ಮಾಡಿದಂತೆ ನಾಶಪಡಿಸಿ.
- ಶಿಫಾರಸು ಮಾಡಿದ ಶಿಲೀಂಧ್ರನಾಶಕ ಸಾಂದ್ರತೆಯನ್ನು ಬಳಸಿ ಮತ್ತು ನಿಗದಿತ ಪ್ರಮಾಣವನ್ನು ಮೀರಬೇಡಿ.
- ಶಿಲೀಂಧ್ರನಾಶಕಗಳನ್ನು ತಯಾರಿಸುವಾಗ ಮತ್ತು ಸಿಂಪಡಿಸುವಾಗ ಸೂಕ್ತ ರಕ್ಷಣಾತ್ಮಕ ಉಡುಪು, ಕೈಗವಸು ಮತ್ತು ಕಣ್ಣಿನ ರಕ್ಷಣೆಯನ್ನು ಧರಿಸಿ.
- ಶಿಲೀಂಧ್ರನಾಶಕ ದ್ರಾವಣಗಳೊಂದಿಗೆ ನೇರ ಸಂಪರ್ಕವನ್ನು ತಪ್ಪಿಸಿ ಮತ್ತು ಸಿಂಪಡಣೆಯ ಹನಿಮಂಜನ್ನು ಉಸಿರಾಡುವುದನ್ನು ತಪ್ಪಿಸಿ.
- ಶಿಲೀಂಧ್ರನಾಶಕಗಳನ್ನು ನಿರ್ವಹಿಸುವಾಗ ಅಥವಾ ಸಿಂಪಡಿಸುವಾಗ ತಿನ್ನಬೇಡಿ, ಕುಡಿಯಬೇಡಿ ಅಥವಾ ಧೂಮಪಾನ ಮಾಡಬೇಡಿ.
- ಮಕ್ಕಳು, ಪ್ರಾಣಿಗಳು, ಆಹಾರ ಮತ್ತು ಕುಡಿಯುವ ನೀರನ್ನು ಸಿಂಪಡಣೆ ಪ್ರದೇಶದಿಂದ ದೂರವಿಡಿ.
- ಸಿಂಪಡಿಸಿದ ನಂತರ ಕೈಗಳು, ಮುಖ ಮತ್ತು ತೆರೆದ ದೇಹದ ಭಾಗಗಳನ್ನು ಸೋಪು ಮತ್ತು ನೀರಿನಿಂದ ತೊಳೆಯಿರಿ.
- ಶಿಫಾರಸು ಮಾಡಿದ ಸಿಂಪಡಣೆ ಚಿಕಿತ್ಸೆಯನ್ನು ಅನ್ವಯಿಸುವಾಗ ಸುಳಿ ಭಾಗವು ಸಂಪೂರ್ಣವಾಗಿ ನೆನೆಯುವಂತೆ ನೋಡಿಕೊಳ್ಳಿ.
*ತೀರ್ಮಾನ*
ಅಡಿಕೆ ತೋಟಗಳಲ್ಲಿ ಮೊಗ್ಗು ಕೊಳೆ ರೋಗದ ಪರಿಣಾಮಕಾರಿ ನಿರ್ವಹಣೆಯು ತೋಟದ ನೈರ್ಮಲ್ಯವನ್ನು ಕಾಪಾಡುವುದು, ಬಾಧಿತ ಸಸ್ಯ ಭಾಗಗಳನ್ನು ತೆಗೆದು ನಾಶಪಡಿಸುವುದು ಮತ್ತು ಸುಳಿ ಭಾಗಕ್ಕೆ ಶಿಫಾರಸು ಮಾಡಿದ ಶಿಲೀಂಧ್ರನಾಶಕ ಚಿಕಿತ್ಸೆಗಳನ್ನು ಅನ್ವಯಿಸುವುದನ್ನು ಒಳಗೊಂಡಿದೆ. ಆರಂಭಿಕ ಗುರುತಿಸುವಿಕೆ ಮತ್ತು ಸಕಾಲಿಕ ನಿರ್ವಹಣೆಯು ರೋಗ ಬೆಳವಣಿಗೆಯನ್ನು ಕಡಿಮೆ ಮಾಡಲು ಮತ್ತು ಮರಕ್ಕೆ ಮತ್ತಷ್ಟು ಹಾನಿಯಾಗುವುದನ್ನು ತಡೆಯಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ.
ಹೆಚ್ಚಿನ ಮಾರ್ಗದರ್ಶನ ಮತ್ತು ಸ್ಥಳ-ನಿರ್ದಿಷ್ಟ ಶಿಫಾರಸುಗಳಿಗಾಗಿ, ರೈತರು ತಮ್ಮ ಹತ್ತಿರದ ಕೃಷಿ ವಿಜ್ಞಾನ ಕೇಂದ್ರ (KVK) ಅಥವಾ ಬ್ಲಾಕ್ ಕೃಷಿ ಅಧಿಕಾರಿಯನ್ನು ಸಂಪರ್ಕಿಸಲು ಸಲಹೆ ನೀಡಲಾಗಿದೆ.

👤 Answered by: Jayashree N

📚 Sources:
Integrated Pest and disease management in arecanut _KVK_Mangaluru, Dakshina Kannada.pdf

⚠️ ಮಹತ್ವದ ಸೂಚನೆ (ಪರೀಕ್ಷಾ ಹಂತ) ⚠️

ಈ AjraSakha ಅಪ್ಲಿಕೇಶನ್ ಅಭಿವೃದ್ಧಿ ಹಂತದಲ್ಲಿದ್ದು, ಕೇವಲ ಪರೀಕ್ಷೆ ಮತ್ತು ಮೌಲ್ಯಮಾಪನಕ್ಕಾಗಿ ಮಾತ್ರ ಉದ್ದೇಶಿಸಲಾಗಿದೆ.
ಸಲಹೆಗಳು ಪ್ರಾಯೋಗಿಕವಾಗಿದ್ದು, ಪ್ರಸ್ತುತ ಆಯ್ದ ರಾಜ್ಯಗಳಲ್ಲಿ ಪ್ರಮುಖ ಬೆಳೆಗಳನ್ನು ಒಳಗೊಂಡಿವೆ.

ಹವಾಮಾನ ಮಾಹಿತಿಯನ್ನು IMD ನಿಂದ ಪಡೆಯಲಾಗಿದೆ.
ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿಯನ್ನು eNAM, Agmarknet ಮತ್ತು ರಾಜ್ಯ APMCಗಳಿಂದ ಪಡೆಯಲಾಗಿದೆ.
ಮಣ್ಣಿನ ಆರೋಗ್ಯ ಮಾರ್ಗದರ್ಶನವನ್ನು https://soilhealth.dac.gov.in/fertilizer-dosage ನಿಂದ ಪಡೆಯಲಾಗಿದೆ.
ಸರ್ಕಾರಿ ಯೋಜನೆಗಳನ್ನು https://www.myscheme.gov.in/ ನಿಂದ ಪಡೆಯಲಾಗಿದೆ.
ಇತರ ಕೃಷಿ ಮಾಹಿತಿ ಮತ್ತು ಸಲಹೆಗಳನ್ನು Annam.ai ನ ತಜ್ಞರು ಪರಿಶೀಲಿಸಿ ದೃಢೀಕರಿಸಿದ್ದಾರೆ.

ಬಳಕೆದಾರರು ಯಾವುದೇ ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳುವ ಮೊದಲು ಶಿಫಾರಸುಗಳನ್ನು ಸ್ವತಂತ್ರವಾಗಿ ಪರಿಶೀಲಿಸಬೇಕು.
    `
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