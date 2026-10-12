.PHONY: dev app package deliver check hooks tokens test clean

dev:
	sh scripts/dev.sh

app:
	sh scripts/build-release.sh
	open .build/release/Build/Products/Release/DeepDive.app

package:
	sh scripts/package-macos.sh

deliver:
	sh scripts/deliver.sh

check:
	(cd frontend && npm run lint && npm run build)

hooks:
	git config core.hooksPath scripts/git-hooks

tokens:
	node frontend/packages/design/gen-tokens.mjs

test:
	sh scripts/test.sh

clean:
	rm -rf .build dist
