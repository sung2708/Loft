import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Điều khoản sử dụng",
    summary: "Những điều cần biết khi dùng Mingly.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật",
    updatedAt: "03/11/2026",
    sections: [
      { title: "Sử dụng Mingly", paragraphs: ["Bạn có thể tham gia bằng tài khoản hoặc với tư cách khách nếu phòng cho phép. Hãy giữ an toàn thông tin đăng nhập và liên kết mời của bạn.", "Chủ phòng có thể đặt quyền truy cập, mời hoặc chặn người tham gia và kết thúc phòng. Khi phòng kết thúc, mọi người sẽ bị ngắt kết nối và liên kết mời không còn dùng được."] },
      { title: "Nội dung trong phòng", paragraphs: ["Bạn vẫn sở hữu tin nhắn, nét vẽ và nội dung mình chia sẻ. Mingly cần lưu, truyền và hiển thị nội dung đó để phòng hoạt động. Người cùng phòng có thể nhìn thấy nội dung bạn gửi.", "Chỉ chia sẻ nội dung và liên kết mà bạn có quyền sử dụng. Đừng ghi lại, đăng lại hoặc phát lại nội dung của người khác khi chưa được phép."] },
      { title: "Ứng xử", paragraphs: ["Không quấy rối, lừa đảo, xâm phạm quyền riêng tư hoặc chia sẻ nội dung trái pháp luật. Không cố truy cập phòng hay tài khoản của người khác, phá hoạt động của dịch vụ hoặc vượt qua quyền truy cập được cấp.", "Chúng tôi có thể hạn chế hoặc chấm dứt quyền truy cập khi cần xử lý vi phạm, rủi ro bảo mật hoặc yêu cầu hợp pháp."] },
      { title: "Dịch vụ bên ngoài", paragraphs: ["Khi dùng Google để đăng nhập hoặc YouTube để tìm và phát video, điều khoản của các dịch vụ đó cũng áp dụng. Mingly không sở hữu video trên YouTube."] },
      { title: "Thay đổi", paragraphs: ["Tính năng có thể thay đổi hoặc tạm ngừng để bảo trì, xử lý sự cố hay đáp ứng yêu cầu pháp lý. Nếu điều khoản thay đổi, chúng tôi sẽ cập nhật ngày trên trang này. Những thay đổi quan trọng sẽ được thông báo rõ hơn trước khi áp dụng khi cần."] },
    ],
  },
  en: {
    title: "Terms of Service",
    summary: "What to know when using Mingly.",
    backLabel: "Back to home",
    updatedLabel: "Updated",
    updatedAt: "03/11/2026",
    sections: [
      { title: "Using Mingly", paragraphs: ["You can join with an account or as a guest if a room allows it. Keep your sign-in details and invite links safe.", "Room hosts can set access, invite or block participants, and end a room. Ending a room disconnects everyone and disables its invite link."] },
      { title: "Content in rooms", paragraphs: ["You keep ownership of the messages, drawings, and other content you share. Mingly needs to store, transmit, and display that content for the room to work. People in the room can see what you send.", "Only share content and links you have the right to use. Do not record, repost, or restream another person's content without permission."] },
      { title: "Conduct", paragraphs: ["Do not harass or defraud others, invade their privacy, or share unlawful content. Do not try to access someone else's room or account, disrupt the service, or bypass access controls.", "We may limit or end access to address a violation, a security risk, or a lawful request."] },
      { title: "Other services", paragraphs: ["If you sign in with Google or use YouTube to search for and play videos, those services' terms also apply. Mingly does not own YouTube videos."] },
      { title: "Changes", paragraphs: ["Features may change or pause for maintenance, incident response, or legal requirements. If these terms change, we will update the date on this page. Where needed, we will give clearer notice before a significant change takes effect."] },
    ],
  },
};

export default function TermsPage() {
  return <LegalPage copies={copies} />;
}
