.PHONY: help init plan apply destroy test install clean setup-secrets

# Default target
help:
	@echo "GitHub Data Platform - Cloudflare Workers"
	@echo ""
	@echo "Available commands:"
	@echo "  make setup          - Initial setup (copy configs, install deps)"
	@echo "  make init           - Initialize Terraform"
	@echo "  make plan           - Show Terraform plan"
	@echo "  make apply          - Apply Terraform changes"
	@echo "  make destroy        - Destroy all Terraform resources"
	@echo "  make test           - Run all tests"
	@echo "  make test-scheduler - Run scheduler worker tests"
	@echo "  make test-fetcher   - Run fetcher worker tests"
	@echo "  make install        - Install all dependencies"
	@echo "  make clean          - Clean build artifacts"
	@echo "  make setup-secrets  - Guide for setting up secrets"
	@echo "  make deploy         - Deploy workers (after terraform apply)"
	@echo ""

# Initial setup
setup:
	@echo "📦 Setting up project..."
	@if [ ! -f terraform/terraform.tfvars ]; then \
		cp terraform/terraform.tfvars.example terraform/terraform.tfvars; \
		echo "✅ Created terraform/terraform.tfvars - please edit with your values"; \
	else \
		echo "✅ terraform/terraform.tfvars already exists"; \
	fi
	@echo "📚 Please read docs/SETUP_TODO.md for manual setup steps"

# Terraform commands
init:
	@echo "🔧 Initializing Terraform..."
	cd terraform && terraform init

plan: init
	@echo "📋 Planning Terraform changes..."
	cd terraform && terraform plan

apply: init
	@echo "🚀 Applying Terraform changes..."
	cd terraform && terraform apply
	@echo ""
	@echo "⚠️  Manual steps required! Run: make setup-secrets"

destroy:
	@echo "⚠️  WARNING: This will destroy all resources!"
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@read
	cd terraform && terraform destroy

# Install dependencies
install:
	@echo "📦 Installing dependencies..."
	cd workers/github-scheduler && npm ci
	cd workers/github-fetcher && npm ci
	@echo "✅ Dependencies installed"

# Test commands
test: test-scheduler test-fetcher

test-scheduler:
	@echo "🧪 Testing Scheduler Worker..."
	cd workers/github-scheduler && npm test

test-fetcher:
	@echo "🧪 Testing Fetcher Worker..."
	cd workers/github-fetcher && npm test

test-coverage:
	@echo "📊 Generating test coverage..."
	cd workers/github-scheduler && npm run test:coverage
	cd workers/github-fetcher && npm run test:coverage

# Clean
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf workers/github-scheduler/node_modules
	rm -rf workers/github-fetcher/node_modules
	rm -rf workers/github-scheduler/coverage
	rm -rf workers/github-fetcher/coverage
	rm -rf terraform/.terraform
	rm -rf terraform/.terraform.lock.hcl
	@echo "✅ Clean complete"

# Setup secrets guide
setup-secrets:
	@echo "🔐 Setting up secrets..."
	@echo ""
	@echo "1. Create GitHub Personal Access Token:"
	@echo "   → https://github.com/settings/tokens"
	@echo "   Scopes needed: repo, read:org, read:user, user:email"
	@echo ""
	@echo "2. Set secrets for Scheduler Worker:"
	@echo "   cd workers/github-scheduler"
	@echo "   wrangler secret put GITHUB_TOKEN"
	@echo ""
	@echo "3. Set secrets for Fetcher Worker:"
	@echo "   cd workers/github-fetcher"
	@echo "   wrangler secret put GITHUB_TOKEN"
	@echo ""
	@echo "4. Update wrangler.toml files with Terraform outputs:"
	@echo "   cd terraform && terraform output"
	@echo ""
	@echo "See docs/SETUP_TODO.md for detailed instructions"

# Update wrangler configs with Terraform outputs
update-wrangler:
	@echo "📝 Updating wrangler.toml files..."
	@echo "Run the following commands manually:"
	@echo ""
	@echo "cd terraform && terraform output kv_namespace_id"
	@echo "cd terraform && terraform output kv_namespace_production_id"
	@echo ""
	@echo "Then update workers/*/wrangler.toml with these IDs"

# Deploy workers (after terraform apply and secrets setup)
deploy:
	@echo "🚀 Deploying Workers..."
	@echo ""
	@echo "⚠️  Make sure you have:"
	@echo "  1. Run 'make apply' successfully"
	@echo "  2. Set up secrets via 'make setup-secrets'"
	@echo "  3. Updated wrangler.toml files"
	@echo ""
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@read
	@echo "Deploying Scheduler Worker..."
	cd workers/github-scheduler && wrangler deploy
	@echo "Deploying Fetcher Worker..."
	cd workers/github-fetcher && wrangler deploy
	@echo "✅ Deployment complete!"

# Check status
status:
	@echo "📊 Checking deployment status..."
	cd workers/github-scheduler && wrangler deployments list
	cd workers/github-fetcher && wrangler deployments list

# View logs
logs-scheduler:
	@echo "📋 Tailing Scheduler Worker logs..."
	cd workers/github-scheduler && wrangler tail

logs-fetcher:
	@echo "📋 Tailing Fetcher Worker logs..."
	cd workers/github-fetcher && wrangler tail

# Trigger scheduler manually
trigger:
	@echo "⚡ Triggering Scheduler Worker manually..."
	@echo "Enter the worker URL (e.g., https://github-scheduler.your-subdomain.workers.dev):"
	@read url; \
	curl -X POST "$$url/trigger"
