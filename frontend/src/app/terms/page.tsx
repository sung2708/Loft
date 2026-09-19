import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Điều khoản sử dụng",
    summary: "Các điều khoản này quy định quyền, trách nhiệm và giới hạn khi bạn dùng Mingly để tạo phòng, trò chuyện và chia sẻ nội dung.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật lần cuối",
    notice: "Các tính năng có thể thay đổi trong giai đoạn thử nghiệm. Hiện Mingly không cung cấp kết nối Spotify hoặc dịch vụ âm nhạc OAuth. Không dùng Mingly cho tình huống cần lưu trữ bản ghi hoặc liên lạc khẩn cấp.",
    sections: [
      { title: "Sử dụng dịch vụ", paragraphs: ["Bạn chỉ sử dụng Mingly cho mục đích hợp pháp, tôn trọng người khác và tuân thủ điều khoản của các dịch vụ liên kết như Google, YouTube và LiveKit."] },
      { title: "Phòng và quyền quản trị", paragraphs: ["Chủ phòng chịu trách nhiệm về người được mời, cài đặt khách, mật khẩu, khóa phòng và các thao tác quản trị. Chủ phòng có thể mời, xóa hoặc chặn thành viên theo quyền được cấp trong ứng dụng."] },
      { title: "Nội dung và hành vi bị cấm", paragraphs: ["Không dùng Mingly để quấy rối, lừa đảo, xâm phạm quyền riêng tư, phát tán nội dung bất hợp pháp hoặc cố gắng truy cập trái phép vào phòng, tài khoản hay hệ thống.", "Bạn chịu trách nhiệm bảo đảm quyền cần thiết đối với nội dung, liên kết hoặc media bạn chia sẻ. Không được sao chép, trích xuất, tải xuống, restream hoặc né các giới hạn của dịch vụ nội dung bên thứ ba."] },
      { title: "Nội dung nhúng và dịch vụ bên thứ ba", paragraphs: ["YouTube có điều khoản riêng. Khi dùng trình phát nhúng, bạn đồng ý tuân thủ điều khoản áp dụng của YouTube. Mingly không sở hữu nội dung này và có thể giới hạn tính năng khi nhà cung cấp yêu cầu hoặc khi cần bảo mật."] },
      { title: "Tài khoản, an toàn và thực thi", paragraphs: ["Bạn chịu trách nhiệm về hoạt động trong tài khoản và phòng của mình. Không chia sẻ thông tin đăng nhập hoặc cố vượt qua giới hạn quyền. Chúng tôi có thể khóa, giới hạn hoặc chấm dứt quyền truy cập khi có rủi ro bảo mật, hành vi vi phạm hoặc yêu cầu pháp lý hợp lệ."] },
      { title: "Thay đổi dịch vụ", paragraphs: ["Mingly có thể cập nhật, giới hạn hoặc ngừng một tính năng để bảo mật, bảo trì hoặc cải thiện dịch vụ. Điều khoản mới sẽ được công bố tại trang này."] },
    ],
  },
  en: {
    title: "Terms of Service",
    summary: "These terms set out the rights, responsibilities, and limits that apply when you use Mingly to create rooms, talk, and share content.",
    backLabel: "Back to home",
    updatedLabel: "Last updated",
    notice: "Features may change while in experimentation. Mingly currently provides no Spotify connection or music-service OAuth. Do not use Mingly where a recording or emergency communication is required.",
    sections: [
      { title: "Using the service", paragraphs: ["Use Mingly only for lawful purposes, respect other people, and comply with the terms of connected services such as Google, YouTube, and LiveKit."] },
      { title: "Rooms and moderation", paragraphs: ["Room hosts are responsible for the people they invite and for guest access, passwords, room locks, and moderation actions. Hosts can invite, remove, or block participants through the permissions provided in the app."] },
      { title: "Prohibited conduct", paragraphs: ["Do not use Mingly to harass, defraud, invade privacy, distribute unlawful content, or attempt unauthorized access to a room, account, or system.", "You are responsible for having the rights needed for content, links, or media you share. Do not copy, extract, download, restream, or bypass limitations of third-party content services."] },
      { title: "Embedded content and third-party services", paragraphs: ["YouTube has its own terms. When you use the embedded player, you agree to comply with YouTube's applicable terms. Mingly does not own that content and may limit the feature when required by the provider or for security."] },
      { title: "Accounts, safety, and enforcement", paragraphs: ["You are responsible for activity on your account and in your rooms. Do not share sign-in credentials or attempt to bypass permission limits. We may suspend, limit, or end access where there is a security risk, a violation, or a valid legal requirement."] },
      { title: "Service changes", paragraphs: ["Mingly may update, limit, or discontinue a feature for security, maintenance, or service improvement. Updated terms will be published on this page."] },
    ],
  },
};

export default function TermsPage() {
  return <LegalPage copies={copies} />;
}
