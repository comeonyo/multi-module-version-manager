# 멀티 모듈 버전 관리자 액션

이 GitHub Action은 컨벤셔널 커밋을 기반으로 프로젝트의 여러 Gradle 모듈 버전을 자동으로 관리합니다. 마지막 릴리스 이후의 커밋 메시지를 분석하고, 시맨틱 버저닝 규칙에 따라 적절한 버전 업데이트를 결정하며, 모듈 간의 상호 의존성을 처리합니다.

## 주요 기능

- 🔄 멀티 모듈 Gradle 프로젝트의 자동 버전 관리
- 📦 컨벤셔널 커밋 기반 시맨틱 버저닝
- 🔍 의존성 그래프 분석 및 순환 의존성 감지
- 📝 CHANGELOG 자동 생성
- 🏷️ Git 태그 및 GitHub 릴리스 자동화
- ✅ 검증을 위한 드라이 런 모드

## 사용법

```yaml
name: 버전 관리
on:
  push:
    branches: [ main ]

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # 중요: 전체 히스토리 필요
      
      - name: 버전 업데이트
        uses: your-username/multi-module-version-manager@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## 입력 값

| 입력 | 설명 | 필수 | 기본값 |
|-------|-------------|----------|---------|
| `working-directory` | Gradle 모듈이 있는 루트 디렉토리 | 아니오 | `.` |
| `dry-run` | 실제 변경 없이 드라이 런 모드로 실행 | 아니오 | `false` |
| `github-token` | 태그 및 릴리스 생성을 위한 GitHub 토큰 | 예 | N/A |

## 작동 방식

1. **의존성 분석**
    - `settings.gradle.kts`를 스캔하여 모든 모듈 식별
    - `build.gradle.kts` 파일에서 의존성 그래프 구축
    - 순환 의존성 감지 및 방지

2. **버전 계산**
    - 컨벤셔널 커밋 형식을 사용하여 마지막 릴리스 이후의 커밋 분석
    - 각 모듈의 버전 업데이트 유형(major/minor/patch) 결정
    - 버전 계산 시 의존성 관계 고려

3. **업데이트 프로세스**
    - 빌드 파일의 버전 번호 업데이트
    - 포괄적인 CHANGELOG.md 파일 생성
    - Git 태그 및 GitHub 릴리스 생성

## 커밋 컨벤션

이 액션은 [Conventional Commits](https://www.conventionalcommits.org/) 명세를 따릅니다:

- `feat!:` 또는 `BREAKING CHANGE`: major 버전 업데이트 트리거
- `feat:`: minor 버전 업데이트 트리거
- `fix:`: patch 버전 업데이트 트리거

## 프로젝트 구조 요구사항

Gradle 프로젝트는 다음 구조를 따라야 합니다:

```
root/
  ├── settings.gradle.kts
  ├── module1/
  │   ├── build.gradle.kts
  │   └── src/
  ├── module2/
  │   ├── build.gradle.kts
  │   └── src/
  └── ...
```

## 예시

module2가 module1에 의존하는 두 개의 모듈이 있는 프로젝트를 고려해봅시다:

```kotlin
// settings.gradle.kts
include(":module1")
include(":module2")

// module2/build.gradle.kts
dependencies {
    implementation(project(":module1"))
}
```

module1에 breaking change가 있는 경우:
- module1: 1.0.0 → 2.0.0 (breaking change로 인한 major 업데이트)
- module2: 1.0.0 → 1.1.0 (주요 의존성 업데이트로 인한 minor 업데이트)

## 문제 해결

### 일반적인 문제

1. **버전 변경이 감지되지 않는 경우**
    - 커밋이 컨벤셔널 커밋 형식을 따르는지 확인
    - 전체 git 히스토리가 있는지 확인 (`fetch-depth: 0`)

2. **권한 오류**
    - `github-token`이 충분한 권한을 가지고 있는지 확인
    - 토큰이 태그 및 릴리스를 생성할 수 있는지 확인

3. **빌드 실패**
    - settings.gradle.kts의 모든 모듈 경로가 올바른지 확인
    - build.gradle.kts 파일에 유효한 버전 선언이 있는지 확인
