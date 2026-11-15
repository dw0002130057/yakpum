# 약품·급여 조회

공공데이터(식약처·심평원)를 매달 미리 받아 두고, 화면은 그 파일을 바로 읽어서 1초 안에 보여 주는 사이트.

- `site/index.html` : 화면
- `build/build.mjs` : 공공데이터 받기 → `site/data/` 파일 만들기
- `.github/workflows/build.yml` : 매달 2일 새벽 3시 자동 실행 (Actions 탭에서 바로 실행도 가능)
- 인증키는 저장소 Settings > Secrets and variables > Actions 의 `SERVICE_KEY` 에 등록
