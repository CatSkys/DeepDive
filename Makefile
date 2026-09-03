.PHONY: dev app package tokens clean

dev:
	sh scripts/dev.sh

app:
	sh scripts/build-release.sh
	open .build/release/Build/Products/Release/DeepDive.app

package:
	sh scripts/package-macos.sh

tokens:
	node frontend/packages/design/gen-tokens.mjs

clean:
	rm -rf .build dist
