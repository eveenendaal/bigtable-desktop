cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.3.1"
  sha256 arm:   "6001793bd5a6f65fdbe0da03ad4bc5d923b5c0b61822504c884531c11e80ed0f",
         intel: "7dec1f396515d92b7330991fd6974b997a7ede425b3d80c10711259f27ff89a3"

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
