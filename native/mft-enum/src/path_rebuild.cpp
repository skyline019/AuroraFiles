#include "path_rebuild.hpp"
#include <algorithm>

static inline uint64_t frn_index(uint64_t frn) {
  return frn & 0x0000FFFFFFFFFFFFULL;
}

std::wstring rebuild_path(
  uint64_t frn,
  const std::unordered_map<uint64_t, MftNode>& nodes,
  wchar_t drive_letter,
  uint64_t root_frn)
{
  std::vector<std::wstring> parts;
  uint64_t cur = frn_index(frn);
  const uint64_t root = frn_index(root_frn);
  int guard = 0;
  while (cur != 0 && guard++ < 512) {
    if (root != 0 && cur == root) break;
    // NTFS root (#5) may be absent from FSCTL_ENUM_USN_DATA output
    if (cur == 5 && (root == 0 || root == 5)) break;
    auto it = nodes.find(cur);
    if (it == nodes.end()) {
      if (root != 0 && cur == root) break;
      if (cur == 5) break;
      return L"";
    }
    const MftNode& n = it->second;
    const uint64_t parent = frn_index(n.parent);
    if (parent == cur) break; // self-parent = volume root dir
    if (!n.name.empty()) parts.push_back(n.name);
    if (parent == 0) break;
    cur = parent;
  }
  std::reverse(parts.begin(), parts.end());
  std::wstring out;
  out.push_back(drive_letter);
  out.push_back(L':');
  out.push_back(L'\\');
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i) out.push_back(L'\\');
    out.append(parts[i]);
  }
  // Root itself: "E:\"
  if (parts.empty()) {
    out.clear();
    out.push_back(drive_letter);
    out.push_back(L':');
    out.push_back(L'\\');
  }
  return out;
}

int path_rebuild_self_test() {
  std::unordered_map<uint64_t, MftNode> nodes;
  // root 5 -> self
  nodes[5] = MftNode{5, L".", true};
  nodes[10] = MftNode{5, L"Users", true};
  nodes[20] = MftNode{10, L"Alice", true};
  nodes[30] = MftNode{20, L"readme.txt", false};

  auto p = rebuild_path(30, nodes, L'E', 5);
  const std::wstring expect = L"E:\\Users\\Alice\\readme.txt";
  if (p != expect) return 1;

  auto root = rebuild_path(5, nodes, L'E', 5);
  if (root != L"E:\\") return 2;

  auto orphan = rebuild_path(99, nodes, L'E', 5);
  if (!orphan.empty()) return 3;
  return 0;
}
