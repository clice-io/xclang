/// Vulkan-Hpp through its module, the largest module in common use:
/// structure chains, enums to strings, format traits and hashing, with no
/// device (it is compiled, not run).

import vulkan;
import vulkan_video;

namespace app {

vk::ApplicationInfo application() {
  return vk::ApplicationInfo{}
      .setPApplicationName("xclang-train")
      .setApplicationVersion(vk::makeApiVersion(0, 1, 0, 0))
      .setPEngineName("none")
      .setApiVersion(vk::ApiVersion14);
}

std::vector<vk::Format> depth_formats() {
  std::vector<vk::Format> out;
  for (auto f : {vk::Format::eD16Unorm, vk::Format::eD32Sfloat, vk::Format::eD24UnormS8Uint, vk::Format::eR8G8B8A8Srgb,
                 vk::Format::eBc7UnormBlock, vk::Format::eAstc4x4SrgbBlock}) {
    if (vk::componentCount(f) > 0 && std::string_view(vk::compatibilityClass(f)).contains("D")) out.push_back(f);
  }
  return out;
}

auto device_chain() {
  vk::StructureChain<vk::DeviceCreateInfo, vk::PhysicalDeviceFeatures2, vk::PhysicalDeviceVulkan12Features,
                     vk::PhysicalDeviceVulkan13Features>
      chain;
  chain.get<vk::PhysicalDeviceVulkan12Features>().setTimelineSemaphore(true).setBufferDeviceAddress(true);
  chain.get<vk::PhysicalDeviceVulkan13Features>().setDynamicRendering(true).setSynchronization2(true);
  chain.unlink<vk::PhysicalDeviceVulkan13Features>();
  return chain;
}

vk::PipelineColorBlendAttachmentState blend() {
  return vk::PipelineColorBlendAttachmentState{}
      .setBlendEnable(true)
      .setSrcColorBlendFactor(vk::BlendFactor::eSrcAlpha)
      .setDstColorBlendFactor(vk::BlendFactor::eOneMinusSrcAlpha)
      .setColorWriteMask(vk::ColorComponentFlagBits::eR | vk::ColorComponentFlagBits::eG |
                         vk::ColorComponentFlagBits::eB | vk::ColorComponentFlagBits::eA);
}

}  // namespace app

int main() {
  auto info = app::application();
  auto chain = app::device_chain();
  std::unordered_set<vk::Format> seen(std::from_range, app::depth_formats());
  std::size_t hash = std::hash<vk::ApplicationInfo>{}(info) ^ std::hash<vk::PipelineColorBlendAttachmentState>{}(app::blend());
  vk::ImageSubresourceRange range{vk::ImageAspectFlagBits::eColor, 0, vk::RemainingMipLevels, 0, 1};
  vk::VideoProfileInfoKHR video{vk::VideoCodecOperationFlagBitsKHR::eDecodeH264};
  std::println("{} {} {} {} {:x} {}", vk::to_string(vk::Format::eR8G8B8A8Srgb), vk::to_string(range.aspectMask),
               vk::to_string(video.videoCodecOperation), seen.size(), hash,
               chain.get<vk::DeviceCreateInfo>().pNext != nullptr);
}
