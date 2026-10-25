# 보고서 문법 교정 검증 (gemma3:1b)

**틀린 문장 12/15 잡음 (재현율 80%) · 맞는 문장 오교정 2/15 (13%)**

| 구분 | 학습자 문장 | 모델 출력 | 채택된 교정 | 판정 |
|---|---|---|---|---|
| 틀린 문장 | I go to gym this morning. | I go to the gym this morning. | I go to the gym this morning. | ✅ 잡음 (참고: I went to the gym this morning.) |
| 틀린 문장 | I am learning guitar for 2 years. | I’ve been learning the guitar for two years. | I’ve been learning the guitar for two years. | ✅ 잡음 (참고: I have been learning guitar for 2 years.) |
| 틀린 문장 | I am looking a jacket. | I’m looking for a jacket. | I’m looking for a jacket. | ✅ 잡음 (참고: I am looking for a jacket.) |
| 틀린 문장 | It is little big. | It’s little big. | — | ❌ 놓침 (참고: It is a little big.) |
| 틀린 문장 | I stay in hotel in Manhattan. | I stay at a hotel in Manhattan. | I stay at a hotel in Manhattan. | ✅ 잡음 (참고: I am staying at a hotel in Manhattan.) |
| 틀린 문장 | I am software engineer in Seoul. | I work as a software engineer in Seoul. | — | ❌ 놓침 (참고: I am a software engineer in Seoul.) |
| 틀린 문장 | Yesterday I eat pizza with my friend. | I ate pizza with my friend yesterday. | I ate pizza with my friend yesterday. | ✅ 잡음 (참고: Yesterday I ate pizza with my friend.) |
| 틀린 문장 | She don't like spicy food. | She doesn’t like spicy food. | She doesn’t like spicy food. | ✅ 잡음 (참고: She doesn't like spicy food.) |
| 틀린 문장 | I have return ticket. | I have a return ticket. | I have a return ticket. | ✅ 잡음 (참고: I have a return ticket.) |
| 틀린 문장 | I very like Korean food. | I really like Korean food. | I really like Korean food. | ✅ 잡음 (참고: I really like Korean food.) |
| 틀린 문장 | My weakness is I am sometimes too careful. | I’m sometimes too cautious. | — | ❌ 놓침 (참고: My weakness is that I am sometimes too careful.) |
| 틀린 문장 | Can you recommend me a good restaurant? | Could you recommend a good restaurant? | Could you recommend a good restaurant? | ✅ 잡음 (참고: Can you recommend a good restaurant?) |
| 틀린 문장 | I was born in 1998 and I live in Busan since then. | I was born in 1998 and I’ve lived in Busan ever since. | I was born in 1998 and I’ve lived in Busan ever since. | ✅ 잡음 (참고: I have lived in Busan since then.) |
| 틀린 문장 | He is more taller than me. | He is taller than me. | He is taller than me. | ✅ 잡음 (참고: He is taller than me.) |
| 틀린 문장 | I want to going to the museum. | I want to go to the museum. | I want to go to the museum. | ✅ 잡음 (참고: I want to go to the museum.) |
| 맞는 문장 | I like running and playing the guitar. | I like to run and play the guitar. | I like to run and play the guitar. | ❌ 오교정 |
| 맞는 문장 | Can I pay by card? | Can I pay with card? | Can I pay with card? | ❌ 오교정 |
| 맞는 문장 | I'd like a medium iced latte, please. | I’d like a medium iced latte, please. | — | ✅ 그대로 |
| 맞는 문장 | This weekend I will meet my friend Minji. | I’m going to meet my friend Minji this weekend. | — | ✅ 그대로 |
| 맞는 문장 | We are going to eat tteokbokki in Hongdae. | We’re going to eat tteokbokki in Hongdae. | — | ✅ 그대로 |
| 맞는 문장 | I have been working as a developer for three years. | I’ve been working as a developer for three years. | — | ✅ 그대로 |
| 맞는 문장 | Could you tell me more about the team? | Could you tell me more about the team? | — | ✅ 그대로 |
| 맞는 문장 | I think Korean food is the best. | I think Korean food is the best. | — | ✅ 그대로 |
| 맞는 문장 | I'm staying at a hotel near Times Square. | I’m staying at a hotel near Times Square. | — | ✅ 그대로 |
| 맞는 문장 | Do you have this jacket in black? | Do you have this jacket in black? | — | ✅ 그대로 |
| 맞는 문장 | I usually go jogging before work. | I usually go for a run before work. | — | ✅ 그대로 |
| 맞는 문장 | My favorite season is autumn. | My favorite season is fall. | — | ✅ 그대로 |
| 맞는 문장 | I found the problem and made the app two times faster. | I found the problem and made the app twice faster. | — | ✅ 그대로 |
| 맞는 문장 | How long does it take to walk there? | How long does it take to walk there? | — | ✅ 그대로 |
| 맞는 문장 | I want to join your company because you make global products. | I want to work for your company because you make global products. | — | ✅ 그대로 |
