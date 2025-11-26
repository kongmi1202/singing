# 환경 변수 설정 가이드

## OpenAI API 키 설정

리듬 분석의 연습 전략을 AI로 생성하기 위해 OpenAI API 키가 필요합니다.

### 1. OpenAI API 키 발급

1. [OpenAI Platform](https://platform.openai.com/api-keys)에 접속
2. 계정 로그인 (없으면 회원가입)
3. "Create new secret key" 클릭
4. API 키 복사 (한 번만 표시되므로 안전하게 보관)

### 2. 로컬 개발 환경 설정

프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
VITE_OPENAI_API_KEY=sk-your-api-key-here
```

**주의사항:**
- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.
- API 키를 절대 공개 저장소에 올리지 마세요.

### 3. Netlify 배포 환경 설정

Netlify 대시보드에서 환경 변수를 설정하세요:

1. Netlify 대시보드 → Site settings → Environment variables
2. "Add variable" 클릭
3. Key: `VITE_OPENAI_API_KEY`
4. Value: 발급받은 OpenAI API 키
5. "Save" 클릭
6. 사이트 재배포

### 4. API 키 없이 사용하기

API 키가 없어도 앱은 정상 작동합니다. 다만 연습 전략은 기본 메시지로 표시됩니다.

### 5. 비용 안내

- OpenAI API는 사용량 기반 과금입니다.
- `gpt-4o-mini` 모델을 사용하여 비용을 최소화했습니다.
- 연습 전략 생성 1회당 약 $0.0001~0.0003 정도 소요됩니다.
- 자세한 가격은 [OpenAI Pricing](https://openai.com/api/pricing/) 참고

