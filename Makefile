# One entry point for the checks CI runs. `make check` before every push.
.PHONY: test diagram check screenshots social-preview

test: ## The node test suite (needs qpdf on PATH for the payslip tests)
	npm test

diagram: ## Redraw docs/assets/*.svg
	python3 tools/gen_diagram.py

check: test ## Everything CI checks
	python3 tools/gen_diagram.py --check
	shellcheck scripts/deploy.sh

screenshots: ## Retake docs/assets/screenshots from a throwaway copy of the app (not CI)
	test -x .venv-screenshots/bin/python || ( \
		uv venv -q --python 3.13 .venv-screenshots && \
		VIRTUAL_ENV=.venv-screenshots uv pip install -q -r tools/screenshots/requirements.txt )
	.venv-screenshots/bin/python -m playwright install chromium
	.venv-screenshots/bin/python tools/screenshots/take_screenshots.py
	python3 tools/strip_png.py docs/assets/screenshots/*.png

social-preview: ## Render docs/assets/social-preview.png (1280x640) with the vendored brand kit, metadata stripped
	python3 tools/brand/brand_kit.py social --repo Payroll-Mail-Service \
		--tagline "Email each employee their own NI-locked payslip PDF, in Gmail-safe batches" \
		--chip "Self-hosted" --chip "AES-256 PDFs" --chip "Free, MIT" \
		--icon docs/assets/brand/icon.svg --out docs/assets/social-preview.png
	python3 tools/strip_png.py docs/assets/social-preview.png
