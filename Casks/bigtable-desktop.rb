cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.2.0"
  sha256 arm:   "2f30bdd5d7f9b2ce2c2ba98a0abce8f760e6ee233031f3ae21bbc7e7f832ffbf",
         intel: "876253ac85eb268aae4c4cbe763348a22e4ca9bf99173e0dbdeecafc9c6a0a1c"

  url "https://github.com/eveenendaal/bigtable-desktop/releases/download/v#{version}/bigtable-desktop-#{version}-#{arch}.dmg"
  name "Bigtable Desktop"
  desc "Desktop client for querying and browsing Google Cloud Bigtable"
  homepage "https://github.com/eveenendaal/bigtable-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Bigtable Desktop.app"
  # Starts the built-in MCP server: `claude mcp add bigtable-desktop --scope user -- bigtable-desktop-mcp`
  binary "#{appdir}/Bigtable Desktop.app/Contents/Resources/bin/bigtable-desktop-mcp"

  # The app is ad-hoc signed, not notarized. Clear the quarantine flag so
  # Gatekeeper does not refuse to open it.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Bigtable Desktop.app"]
  end

  # Quits the app during `brew upgrade`; Homebrew reopens it once the new version is installed.
  uninstall quit: "com.eveenendaal.bigtable-desktop"

  zap trash: [
    "~/Library/Application Support/Bigtable Desktop",
    "~/Library/Logs/Bigtable Desktop",
    "~/Library/Preferences/com.eveenendaal.bigtable-desktop.plist",
    "~/Library/Saved Application State/com.eveenendaal.bigtable-desktop.savedState",
  ]
end
