require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Apple's on-device model on iPhone and iPad (the AppleModel Capacitor plugin).
# The core is shared with the Mac helper (Package.swift).
Pod::Spec.new do |s|
  s.name = 'RedstringAppleModel'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/theredstring/redstring'
  s.author = 'Redstring'
  s.source = { :git => 'https://github.com/theredstring/redstring.git', :tag => "v#{package['version']}" }
  s.source_files = 'Sources/AFMCore/**/*.swift', 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '16.4'
  # Present from iOS 26; linked weakly so the app still runs on older systems,
  # where the plugin reports the model unavailable.
  s.weak_frameworks = 'FoundationModels'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
