const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'src/apps/customer/pages/MenuHome.jsx');
let content = fs.readFileSync(p, 'utf8');

const scrollSpyText = '  // Scroll spy\n  useEffect(() => {';
const newScrollSpyText = "  // Scroll spy\n" +
"  const scrollToCategory = (catId) => {\n" +
"    if (catId === 'all') {\n" +
"      isManualScroll.current = true\n" +
"      window.scrollTo({ top: 0, behavior: 'smooth' })\n" +
"      setActiveCategory('all')\n" +
"      setTimeout(() => { isManualScroll.current = false }, 1200)\n" +
"    } else {\n" +
"      const el = sectionRefs.current[catId]\n" +
"      if (el) {\n" +
"        isManualScroll.current = true\n" +
"        el.scrollIntoView({ behavior: 'smooth' })\n" +
"        setActiveCategory(catId)\n" +
"        setTimeout(() => { isManualScroll.current = false }, 1200)\n" +
"      }\n" +
"    }\n" +
"  }\n\n" +
"  useEffect(() => {";

if (!content.includes('const scrollToCategory =')) {
  content = content.replace(scrollSpyText, newScrollSpyText);
}

const normalPillHandler = "                onClick={() => {\n" +
"                  if (cat.id === 'all') {\n" +
"                    isManualScroll.current = true\n" +
"                    window.scrollTo({ top: 0, behavior: 'smooth' })\n" +
"                    setActiveCategory('all')\n" +
"                    setTimeout(() => { isManualScroll.current = false }, 1200)\n" +
"                  } else {\n" +
"                    const el = sectionRefs.current[cat.id]\n" +
"                    if (el) {\n" +
"                      isManualScroll.current = true\n" +
"                      const y = el.getBoundingClientRect().top + window.scrollY - 185\n" +
"                      window.scrollTo({ top: y, behavior: 'smooth' })\n" +
"                      setActiveCategory(cat.id)\n" +
"                      setTimeout(() => { isManualScroll.current = false }, 1200)\n" +
"                    }\n" +
"                  }\n" +
"                }}";

content = content.replace(normalPillHandler, "                onClick={() => scrollToCategory(cat.id)}");

const stickyPill = "          <CategoryBubbles categories={categories} activeCategory={activeCategory} onSelectCategory={setActiveCategory} size=\"compact\" />";
const newStickyPill = "          <CategoryBubbles categories={categories} activeCategory={activeCategory} onSelectCategory={scrollToCategory} size=\"compact\" />";
content = content.replace(stickyPill, newStickyPill);

fs.writeFileSync(p, content);
console.log('done');
