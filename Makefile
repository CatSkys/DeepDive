.PHONY: dev app package deliver tokens test clean

dev:
	sh scripts/dev.sh

app:
	sh scripts/build-release.sh
	open .build/release/Build/Products/Release/DeepDive.app

package:
	sh scripts/package-macos.sh

deliver:
	sh scripts/deliver.sh

tokens:
	node frontend/packages/design/gen-tokens.mjs

test:
	sh scripts/test.sh

clean:
	rm -rf .build dist
